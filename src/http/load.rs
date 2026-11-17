use super::{
    Clients, Collection, CookieSession, FailureReason, ResultRow, TIMEOUT_MESSAGE, run_step,
};
use futures_util::{StreamExt, stream::FuturesUnordered};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, sync::Mutex, time::Duration};
use tokio::{sync::oneshot, time::Instant};

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum Profile {
    Constant,
    Ramp,
    Spike,
    Soak,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Options {
    profile: Profile,
    vus: u32,
    duration_seconds: u64,
    #[serde(default = "one")]
    base_vus: u32,
    #[serde(default)]
    phase_seconds: u64,
    #[serde(default)]
    think_ms: u64,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    skip_scripts: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    collection_setup: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_p99_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_error_percent: Option<f64>,
}

fn one() -> u32 {
    1
}

impl Options {
    fn valid(&self) -> bool {
        (1..=500).contains(&self.vus)
            && (1..=86_400).contains(&self.duration_seconds)
            && self.think_ms <= 60_000
            && self.max_p99_ms.is_none_or(|limit| limit <= 3_600_000)
            && self
                .max_error_percent
                .is_none_or(|limit| (0.0..=100.0).contains(&limit))
            && match self.profile {
                Profile::Constant | Profile::Soak => self.phase_seconds == 0,
                Profile::Ramp | Profile::Spike => {
                    (1..self.vus).contains(&self.base_vus)
                        && self.phase_seconds > 0
                        && self.phase_seconds < self.duration_seconds
                        && (!matches!(self.profile, Profile::Spike)
                            || self.duration_seconds - self.phase_seconds >= 2)
                }
            }
    }

    fn window(&self, slot: u32) -> (Duration, Duration) {
        let whole_run = Duration::from_secs(self.duration_seconds);
        if slot >= self.base_vus {
            match self.profile {
                Profile::Ramp => {
                    let ramp = Duration::from_secs(self.phase_seconds);
                    let offset = ramp * (slot - self.base_vus + 1) / (self.vus - self.base_vus);
                    return (offset, whole_run);
                }
                Profile::Spike => {
                    let baseline = Duration::from_secs(self.duration_seconds - self.phase_seconds);
                    let start = baseline / 2;
                    return (start, start + Duration::from_secs(self.phase_seconds));
                }
                _ => {}
            }
        }
        (Duration::ZERO, whole_run)
    }
}

#[derive(Default)]
struct Samples {
    requests: u64,
    errors: u64,
    http_errors: u64,
    transport_errors: u64,
    timeouts: u64,
    validation_failures: u64,
    above_p99_limit: u64,
    total_ms: f64,
    latency: BTreeMap<u64, u64>,
    requests_by_step: Vec<RequestCounts>,
    window: Window,
}

#[derive(Default)]
struct Window {
    requests: u64,
    errors: u64,
    first_error_ms: Option<u64>,
    latency: BTreeMap<u64, u64>,
}

#[derive(Clone, Serialize)]
struct TimelinePoint {
    start_ms: u64,
    end_ms: u64,
    requests: u64,
    errors: u64,
    rps: f64,
    p95_ms: Option<u64>,
    p99_ms: Option<u64>,
    error_percent: Option<f64>,
    first_error_ms: Option<u64>,
}

impl Window {
    fn finish(self, from: Duration, to: Duration) -> TimelinePoint {
        let has_requests = self.requests > 0;
        TimelinePoint {
            start_ms: from.as_millis() as u64,
            end_ms: to.as_millis() as u64,
            requests: self.requests,
            errors: self.errors,
            rps: self.requests as f64 / (to - from).as_secs_f64().max(f64::EPSILON),
            p95_ms: percentile(&self.latency, self.requests, 95),
            p99_ms: percentile(&self.latency, self.requests, 99),
            error_percent: has_requests.then(|| 100.0 * self.errors as f64 / self.requests as f64),
            first_error_ms: self.first_error_ms,
        }
    }
}

fn percentile(latency: &BTreeMap<u64, u64>, requests: u64, percent: u64) -> Option<u64> {
    let rank = (requests * percent).div_ceil(100);
    let mut seen = 0;
    latency.iter().find_map(|(&ms, &count)| {
        seen += count;
        (seen >= rank).then_some(ms)
    })
}

#[derive(Default, Serialize)]
struct RequestCounts {
    requests: u64,
    errors: u64,
    http_errors_by_status: BTreeMap<u16, u64>,
    transport_errors: u64,
    validation_failures: u64,
}

#[derive(Serialize)]
struct RequestStats {
    step: usize,
    #[serde(flatten)]
    counts: RequestCounts,
    error_percent: Option<f64>,
}

#[derive(Clone, Serialize)]
pub struct Metrics {
    duration_ms: u64,
    requests: u64,
    rps: f64,
    mean_ms: Option<f64>,
    p95_ms: Option<u64>,
    p99_ms: Option<u64>,
    error_percent: Option<f64>,
    http_errors: u64,
    transport_errors: u64,
    timeouts: u64,
    validation_failures: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    interval: Option<TimelinePoint>,
}

impl Samples {
    fn record(
        &mut self,
        index: usize,
        ms: u64,
        row: &ResultRow,
        error: Option<&(FailureReason, String)>,
        options: &Options,
        elapsed: Duration,
    ) {
        self.requests += 1;
        let status = row.status.filter(|status| (400..600).contains(status));
        let transport_error = error.is_some();
        let failed = u64::from(status.is_some() || transport_error);
        let validation_failed = u64::from(!row.failures.is_empty());
        let step = &mut self.requests_by_step[index];
        step.requests += 1;
        step.errors += failed;
        if let Some(status) = status {
            *step.http_errors_by_status.entry(status).or_default() += 1;
        }
        step.transport_errors += u64::from(transport_error);
        step.validation_failures += validation_failed;
        self.errors += failed;
        self.http_errors += u64::from(status.is_some());
        self.transport_errors += u64::from(transport_error);
        self.timeouts += u64::from(error.is_some_and(|(_, message)| message == TIMEOUT_MESSAGE));
        self.validation_failures += validation_failed;
        self.total_ms += ms as f64;
        self.above_p99_limit += u64::from(options.max_p99_ms.is_some_and(|limit| ms > limit));
        // Keep histogram memory bounded for long runs. Larger samples use wider buckets.
        let width = if ms <= 10_000 {
            1
        } else if ms <= 600_000 {
            10
        } else {
            1_000
        };
        let bucket = if ms <= 3_600_000 {
            ms.div_ceil(width) * width
        } else {
            ms.checked_next_power_of_two().unwrap_or(u64::MAX)
        };
        // Preserve the threshold boundary when rounding wide buckets upward.
        let bucket = options
            .max_p99_ms
            .filter(|limit| ms <= *limit)
            .map_or(bucket, |limit| bucket.min(limit));
        *self.latency.entry(bucket).or_default() += 1;
        self.window.requests += 1;
        self.window.errors += failed;
        if failed > 0 {
            self.window
                .first_error_ms
                .get_or_insert(elapsed.as_millis() as u64);
        }
        *self.window.latency.entry(bucket).or_default() += 1;
    }

    fn percentile(&self, percent: u64) -> Option<u64> {
        percentile(&self.latency, self.requests, percent)
    }

    fn snapshot(&self, elapsed: Duration, rate_count: u64, rate_elapsed: Duration) -> Metrics {
        let has_requests = self.requests > 0;
        Metrics {
            duration_ms: elapsed.as_millis() as u64,
            requests: self.requests,
            rps: rate_count as f64 / rate_elapsed.as_secs_f64().max(f64::EPSILON),
            mean_ms: has_requests.then(|| self.total_ms / self.requests as f64),
            p95_ms: self.percentile(95),
            p99_ms: self.percentile(99),
            error_percent: has_requests.then(|| 100.0 * self.errors as f64 / self.requests as f64),
            http_errors: self.http_errors,
            transport_errors: self.transport_errors,
            timeouts: self.timeouts,
            validation_failures: self.validation_failures,
            interval: None,
        }
    }
}

#[derive(Serialize)]
pub struct Report {
    schema_version: u8,
    pub exit_code: u8,
    outcome: &'static str,
    options: Options,
    metrics: Metrics,
    p99_passed: Option<bool>,
    error_rate_passed: Option<bool>,
    thresholds: Thresholds,
    requests_by_step: Vec<RequestStats>,
    timeline: Vec<TimelinePoint>,
    #[serde(skip_serializing_if = "Option::is_none")]
    preparation_failure: Option<PreparationFailure>,
}

#[derive(Serialize)]
struct Threshold<T> {
    measured: Option<T>,
    limit: Option<T>,
    passed: Option<bool>,
}

#[derive(Serialize)]
struct Thresholds {
    p99_ms: Threshold<u64>,
    error_percent: Threshold<f64>,
}

#[derive(Serialize)]
struct PreparationFailure {
    step: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    missing_variable: Option<String>,
}

async fn worker(
    clients: &Clients,
    collection: &Collection,
    options: &Options,
    samples: &Mutex<Samples>,
    start: Instant,
    slot: u32,
) -> Result<(), PreparationFailure> {
    let (offset, end) = options.window(slot);
    let end = start + end;
    tokio::time::sleep_until(start + offset).await;
    let mut variables = BTreeMap::new();
    while Instant::now() < end {
        variables.clone_from(&collection.variables);
        let session = CookieSession::default();
        for (index, step) in collection.requests.iter().enumerate() {
            if Instant::now() >= end {
                return Ok(());
            }
            let mut row = ResultRow::new(step);
            let started = Instant::now();
            let result = run_step(clients, &session, step.clone(), &mut variables, &mut row).await;
            let error = result.as_ref().err();
            if let Some((FailureReason::Preparation, message)) = error {
                let missing_variable = message.strip_prefix("Variável ausente: ").filter(|name| {
                    name.len() <= 128
                        && name.bytes().all(|byte| {
                            byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.')
                        })
                });
                return Err(PreparationFailure {
                    step: index + 1,
                    missing_variable: missing_variable.map(str::to_owned),
                });
            }
            let ms = if error.is_some() {
                started.elapsed().as_millis()
            } else {
                row.http_ms
            };
            samples
                .lock()
                .unwrap()
                .record(index, ms as u64, &row, error, options, start.elapsed());
            if options.think_ms > 0 {
                let next = Instant::now() + Duration::from_millis(options.think_ms);
                tokio::time::sleep_until(next.min(end)).await;
            }
            // Restart the flow after failed prerequisites, including failed token extraction.
            if error.is_some() || !row.failures.is_empty() {
                break;
            }
        }
        tokio::task::yield_now().await;
    }
    Ok(())
}

pub async fn run(
    clients: &Clients,
    collection: Collection,
    options: Options,
    mut cancel: oneshot::Receiver<()>,
    progress: impl Fn(Metrics),
) -> Result<Report, String> {
    if !options.valid() || collection.requests.is_empty() {
        return Err("Configuração de carga inválida.".into());
    }
    let samples = Mutex::new(Samples {
        requests_by_step: (0..collection.requests.len())
            .map(|_| RequestCounts::default())
            .collect(),
        ..Samples::default()
    });
    let start = Instant::now();
    let mut workers: FuturesUnordered<_> = (0..options.vus)
        .map(|slot| worker(clients, &collection, &options, &samples, start, slot))
        .collect();
    let mut clock =
        tokio::time::interval_at(start + Duration::from_secs(1), Duration::from_secs(1));
    clock.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut previous = (start, 0);
    let duration = Duration::from_secs(options.duration_seconds);
    // Target at most 600 windows during the load phase. Drain is included in the final window.
    let window_width = Duration::from_secs(options.duration_seconds.div_ceil(600));
    let mut next_window = window_width;
    let mut window_start = Duration::ZERO;
    let mut timeline = Vec::new();
    let (outcome, preparation_failure) = loop {
        tokio::select! {
            biased;
            _ = &mut cancel => break ("cancelled", None),
            tick = clock.tick() => {
                let now = Instant::now();
                let elapsed = now - start;
                let mut samples = samples.lock().unwrap();
                let mut snapshot = samples.snapshot(elapsed, samples.requests - previous.1, now - previous.0);
                if elapsed < duration && tick - start >= next_window {
                    let point = std::mem::take(&mut samples.window).finish(window_start, elapsed);
                    window_start = elapsed;
                    next_window = window_width * (elapsed.as_secs().div_euclid(window_width.as_secs()) as u32 + 1);
                    timeline.push(point.clone());
                    snapshot.interval = Some(point);
                }
                previous = (now, samples.requests);
                drop(samples);
                progress(snapshot);
            }
            result = workers.next() => match result {
                Some(Ok(())) => {}
                Some(Err(failure)) => break ("preparation_error", Some(failure)),
                None => break ("completed", None),
            }
        }
    };
    drop(workers);
    let elapsed = start.elapsed();
    let mut samples = samples.into_inner().unwrap();
    if elapsed.as_millis() > window_start.as_millis() || samples.window.requests > 0 {
        timeline.push(std::mem::take(&mut samples.window).finish(window_start, elapsed));
    }
    let metrics = samples.snapshot(elapsed, samples.requests, elapsed);
    let completed = outcome == "completed" && samples.requests > 0;
    let p99_passed = options.max_p99_ms.filter(|_| completed).map(|_| {
        samples.requests - samples.above_p99_limit >= (samples.requests * 99).div_ceil(100)
    });
    let error_rate_passed = options
        .max_error_percent
        .filter(|_| completed)
        .map(|limit| {
            metrics
                .error_percent
                .is_some_and(|percent| percent <= limit)
        });
    let exit_code = if !completed {
        2
    } else if p99_passed == Some(false) || error_rate_passed == Some(false) {
        1
    } else {
        0
    };
    let thresholds = Thresholds {
        p99_ms: Threshold {
            measured: metrics.p99_ms,
            limit: options.max_p99_ms,
            passed: p99_passed,
        },
        error_percent: Threshold {
            measured: metrics.error_percent,
            limit: options.max_error_percent,
            passed: error_rate_passed,
        },
    };
    let requests_by_step = samples
        .requests_by_step
        .into_iter()
        .enumerate()
        .map(|(index, counts)| {
            let error_percent = (counts.requests > 0)
                .then(|| 100.0 * counts.errors as f64 / counts.requests as f64);
            RequestStats {
                step: index + 1,
                counts,
                error_percent,
            }
        })
        .collect();
    Ok(Report {
        schema_version: 1,
        exit_code,
        outcome,
        options,
        metrics,
        p99_passed,
        error_rate_passed,
        thresholds,
        requests_by_step,
        timeline,
        preparation_failure,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phased_schedules_apply_only_to_additional_users() {
        let seconds = Duration::from_secs;
        let mut options: Options = serde_json::from_value(serde_json::json!({
            "profile": "ramp",
            "base_vus": 2,
            "vus": 4,
            "phase_seconds": 4,
            "duration_seconds": 10
        }))
        .unwrap();
        assert!(options.valid());
        assert_eq!(options.window(0), (Duration::ZERO, seconds(10)));
        assert_eq!(options.window(1), (Duration::ZERO, seconds(10)));
        assert_eq!(options.window(2), (seconds(2), seconds(10)));
        assert_eq!(options.window(3), (seconds(4), seconds(10)));
        options.profile = Profile::Spike;
        assert_eq!(options.window(1), (Duration::ZERO, seconds(10)));
        assert_eq!(options.window(2), (seconds(3), seconds(7)));
        assert_eq!(options.window(3), (seconds(3), seconds(7)));
        options.duration_seconds = 5;
        assert!(!options.valid());
    }

    #[test]
    fn percentiles_use_nearest_rank() {
        let samples = Samples {
            requests: 100,
            latency: BTreeMap::from([(10, 95), (500, 4), (1000, 1)]),
            ..Samples::default()
        };
        assert_eq!(samples.percentile(95), Some(10));
        assert_eq!(samples.percentile(99), Some(500));
        assert_eq!(Samples::default().percentile(99), None);
    }

    #[test]
    fn cancels_before_start_without_evaluating_thresholds() {
        tauri::async_runtime::block_on(async {
            let collection = serde_json::from_value(serde_json::json!({
                "requests": [{"name":"fixture"}]
            }))
            .unwrap();
            let options = serde_json::from_value(serde_json::json!({
                "profile": "soak", "vus": 2, "duration_seconds": 300,
                "max_p99_ms": 500, "max_error_percent": 1
            }))
            .unwrap();
            let (sender, receiver) = oneshot::channel();
            sender.send(()).unwrap();
            let report = run(
                &Clients::new().unwrap(),
                collection,
                options,
                receiver,
                |_| {},
            )
            .await
            .unwrap();
            assert_eq!(report.outcome, "cancelled");
            assert_eq!(report.exit_code, 2);
            assert_eq!(report.metrics.requests, 0);
            assert_eq!(report.p99_passed, None);
            assert_eq!(report.error_rate_passed, None);
        });
    }
}
