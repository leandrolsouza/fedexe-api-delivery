use reqwest::{StatusCode, Url, header};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{cell::RefCell, future::Future, time::Instant};

const MASK: &str = "[***]";
const PREVIEW_LIMIT: usize = 8 * 1024;
const FIELD_LIMIT: usize = 2048;
const HEADER_LIMIT: usize = 64;

#[derive(Default, Deserialize)]
pub(super) struct Masks {
    pub(super) values: Vec<String>,
    pub(super) templates: Vec<String>,
    pub(super) headers: Vec<String>,
    pub(super) query: Vec<String>,
}

#[derive(Serialize)]
pub struct Entry {
    step: Option<usize>,
    duration_ms: u128,
    request: Option<Request>,
    response: Option<Response>,
    redirects: Vec<Redirect>,
    failure: Option<&'static str>,
}

#[derive(Serialize)]
struct Request {
    method: String,
    url: String,
    headers: Vec<(String, String)>,
}

#[derive(Serialize)]
struct Response {
    status: u16,
    headers: Vec<(String, String)>,
    preview: String,
    truncated: bool,
}

#[derive(Serialize)]
struct Redirect {
    status: u16,
    url: String,
    followed: bool,
}

struct Trace {
    start: Instant,
    entry: Entry,
    masks: Masks,
    preview: Vec<u8>,
    truncated: bool,
    json_response: bool,
}

struct Session {
    report: Box<dyn Fn(Entry) + Send + Sync>,
    trace: Option<Trace>,
    extracted: std::collections::BTreeMap<String, String>,
}

tokio::task_local! {
    static SESSION: RefCell<Session>;
}

pub async fn observe<T>(
    report: impl Fn(Entry) + Send + Sync + 'static,
    work: impl Future<Output = T>,
) -> T {
    SESSION
        .scope(
            RefCell::new(Session {
                report: Box::new(report),
                trace: None,
                extracted: Default::default(),
            }),
            work,
        )
        .await
}

pub fn start(step: Option<usize>) {
    let _ = SESSION.try_with(|session| {
        session.borrow_mut().trace = Some(Trace {
            start: Instant::now(),
            entry: Entry {
                step,
                duration_ms: 0,
                request: None,
                response: None,
                redirects: Vec::new(),
                failure: Some("preparation"),
            },
            masks: Masks::default(),
            preview: Vec::new(),
            truncated: false,
            json_response: false,
        });
    });
}

pub(super) fn active() -> bool {
    SESSION
        .try_with(|session| session.borrow().trace.is_some())
        .unwrap_or(false)
}

fn update(work: impl FnOnce(&mut Trace)) {
    let _ = SESSION.try_with(|session| {
        if let Some(trace) = &mut session.borrow_mut().trace {
            work(trace);
        }
    });
}

pub(super) fn masks(mut masks: Masks) {
    let _ = SESSION.try_with(|session| {
        let mut session = session.borrow_mut();
        for value in session.extracted.values() {
            remember(&mut masks.values, value);
        }
        if let Some(trace) = &mut session.trace {
            trace.masks = masks;
        }
    });
}

pub(super) fn extracted(name: &str, value: &str) {
    secret(value);
    let _ = SESSION.try_with(|session| {
        session
            .borrow_mut()
            .extracted
            .insert(name.to_owned(), value.to_owned());
    });
}

pub(super) fn secret(value: &str) {
    update(|trace| remember(&mut trace.masks.values, value));
}

fn remember(values: &mut Vec<String>, value: &str) {
    if !value.is_empty() && !values.iter().any(|known| known == value) {
        values.push(value.to_owned());
    }
}

fn credential(name: &str) -> bool {
    let normalized: String = name
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect();
    matches!(
        normalized.as_str(),
        "authorization"
            | "proxyauthorization"
            | "cookie"
            | "setcookie"
            | "credential"
            | "credentials"
            | "auth"
            | "session"
            | "sessionid"
            | "username"
            | "passwd"
    ) || ["token", "apikey", "secret", "password"]
        .iter()
        .any(|suffix| normalized.ends_with(suffix))
}

fn sensitive(name: &str, custom: &[String]) -> bool {
    credential(name) || custom.iter().any(|key| key.eq_ignore_ascii_case(name))
}

fn clip(mut value: String, limit: usize) -> String {
    if value.len() > limit {
        let mut end = limit;
        while !value.is_char_boundary(end) {
            end -= 1;
        }
        value.truncate(end);
    }
    value
}

fn redact(text: &str, secrets: &[String], incomplete: bool) -> String {
    let mut variants = Vec::new();
    for secret in secrets {
        remember(&mut variants, secret);
        let encoded: String = url::form_urlencoded::byte_serialize(secret.as_bytes()).collect();
        remember(&mut variants, &encoded);
        let path = encoded
            .replace('+', "%20")
            .replace("%7E", "~")
            .replace('*', "%2A");
        remember(&mut variants, &path);
        let component = encoded
            .replace('+', "%20")
            .replace("%7E", "~")
            .replace("%21", "!")
            .replace("%27", "'")
            .replace("%28", "(")
            .replace("%29", ")");
        remember(&mut variants, &component);
        let escaped = serde_json::to_string(secret).expect("serialize string");
        remember(&mut variants, &escaped[1..escaped.len() - 1]);
    }
    variants.sort_unstable_by_key(|value| std::cmp::Reverse(value.len()));
    let mut output = String::new();
    let mut rest = text;
    while !rest.is_empty() {
        if let Some(value) = variants
            .iter()
            .find(|value| rest.starts_with(value.as_str()))
        {
            output.push_str(MASK);
            rest = &rest[value.len()..];
        } else if incomplete && variants.iter().any(|value| value.starts_with(rest)) {
            output.push_str(MASK);
            break;
        } else if let Some(character) = rest.chars().next() {
            output.push(character);
            rest = &rest[character.len_utf8()..];
        }
    }
    output
}

fn redact_url(url: &Url, masks: &Masks) -> String {
    if !matches!(url.scheme(), "http" | "https") {
        return MASK.to_owned();
    }
    let mut url = url.clone();
    let _ = url.set_username("");
    let _ = url.set_password(None);
    url.set_fragment(None);
    if url
        .query_pairs()
        .any(|(key, _)| sensitive(&key, &masks.query))
    {
        let pairs: Vec<_> = url.query_pairs().into_owned().collect();
        url.query_pairs_mut()
            .clear()
            .extend_pairs(pairs.iter().map(|(key, value)| {
                (
                    key,
                    if sensitive(key, &masks.query) {
                        MASK
                    } else {
                        value.as_str()
                    },
                )
            }));
    }
    clip(redact(url.as_str(), &masks.values, false), FIELD_LIMIT)
}

fn register_headers(headers: &header::HeaderMap, masks: &mut Masks) {
    for (name, value) in headers {
        let name = name.as_str();
        if (value.is_sensitive() || sensitive(name, &masks.headers))
            && let Ok(value) = value.to_str()
        {
            remember(&mut masks.values, value);
            match name {
                "authorization" | "proxy-authorization" => {
                    if let Some((_, credential)) = value.split_once(' ') {
                        remember(&mut masks.values, credential);
                    }
                }
                "cookie" | "set-cookie" => {
                    for pair in value
                        .split(';')
                        .take(if name == "cookie" { usize::MAX } else { 1 })
                    {
                        if let Some((_, value)) = pair.split_once('=') {
                            remember(&mut masks.values, value.trim().trim_matches('"'));
                        }
                    }
                }
                _ => {}
            }
        }
    }
}

fn register_query(url: &Url, masks: &mut Masks) {
    for (key, value) in url.query_pairs() {
        if sensitive(&key, &masks.query) {
            remember(&mut masks.values, &value);
        }
    }
}

fn safe_headers(
    headers: &header::HeaderMap,
    masks: &Masks,
    base: Option<&Url>,
) -> Vec<(String, String)> {
    headers
        .iter()
        .take(HEADER_LIMIT)
        .map(|(name, value)| {
            let name = name.as_str();
            let display = if value.is_sensitive() || sensitive(name, &masks.headers) {
                MASK.to_owned()
            } else if name == "location"
                && let Some(base) = base
            {
                value
                    .to_str()
                    .ok()
                    .and_then(|value| base.join(value).ok())
                    .map_or_else(|| MASK.to_owned(), |url| redact_url(&url, masks))
            } else {
                clip(
                    redact(
                        &String::from_utf8_lossy(value.as_bytes()),
                        &masks.values,
                        false,
                    ),
                    FIELD_LIMIT,
                )
            };
            (
                clip(redact(name, &masks.values, false), FIELD_LIMIT),
                display,
            )
        })
        .collect()
}

pub(super) fn request(request: &reqwest::Request) {
    update(|trace| {
        let mut headers = request.headers().clone();
        // Reqwest adds this client default after building the request.
        headers
            .entry(header::ACCEPT)
            .or_insert(header::HeaderValue::from_static("*/*"));
        register_headers(&headers, &mut trace.masks);
        register_query(request.url(), &mut trace.masks);
        trace.entry.request = Some(Request {
            method: clip(
                redact(request.method().as_str(), &trace.masks.values, false),
                FIELD_LIMIT,
            ),
            url: redact_url(request.url(), &trace.masks),
            headers: safe_headers(&headers, &trace.masks, None),
        });
        trace.entry.failure = Some("connection");
    });
}

pub(super) fn response(response: &reqwest::Response) {
    update(|trace| {
        register_headers(response.headers(), &mut trace.masks);
        trace.json_response = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(';').next())
            .is_some_and(|value| {
                let value = value.trim().to_ascii_lowercase();
                value == "application/json" || value.ends_with("+json")
            });
        let location = response
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| response.url().join(value).ok());
        for location in response.headers().get_all(reqwest::header::LOCATION) {
            if let Some(url) = location
                .to_str()
                .ok()
                .and_then(|value| response.url().join(value).ok())
            {
                register_query(&url, &mut trace.masks);
            }
        }
        if matches!(response.status().as_u16(), 301 | 302 | 303 | 307 | 308)
            && let Some(url) = location
            && trace.entry.redirects.len() < 11
        {
            trace.entry.redirects.push(Redirect {
                status: response.status().as_u16(),
                url: redact_url(&url, &trace.masks),
                followed: false,
            });
        }
        trace.entry.response = Some(Response {
            status: response.status().as_u16(),
            headers: safe_headers(response.headers(), &trace.masks, Some(response.url())),
            preview: String::new(),
            truncated: false,
        });
        trace.entry.failure = Some("response");
    });
}

pub(super) fn redirect(status: StatusCode, url: &Url, followed: bool) {
    update(|trace| {
        register_query(url, &mut trace.masks);
        if trace.entry.redirects.len() < 11 {
            trace.entry.redirects.push(Redirect {
                status: status.as_u16(),
                url: redact_url(url, &trace.masks),
                followed,
            });
        }
    });
}

pub(super) fn chunk(chunk: &[u8]) {
    update(|trace| {
        let count = chunk.len().min(PREVIEW_LIMIT - trace.preview.len());
        trace.preview.extend_from_slice(&chunk[..count]);
        trace.truncated |= count < chunk.len();
    });
}

pub(super) fn transport_error(error: &reqwest::Error) {
    let stage = if error.is_redirect() {
        "redirect"
    } else if error.is_connect() {
        "connection"
    } else {
        "transmission"
    };
    update(|trace| trace.entry.failure = Some(stage));
}

pub(super) fn resolution_error() {
    update(|trace| trace.entry.failure = Some("resolution"));
}

fn mask_json(value: &mut Value, masks: &mut Masks) {
    match value {
        Value::Object(object) => {
            for (key, value) in object {
                if sensitive(key, &masks.headers) || sensitive(key, &masks.query) {
                    remember_json_secrets(value, &mut masks.values);
                    *value = Value::String(MASK.to_owned());
                } else {
                    mask_json(value, masks);
                }
            }
        }
        Value::Array(array) => array.iter_mut().for_each(|value| mask_json(value, masks)),
        _ => {}
    }
}

fn remember_json_secrets(value: &Value, secrets: &mut Vec<String>) {
    match value {
        Value::String(value) => remember(secrets, value),
        Value::Number(_) => remember(secrets, &value.to_string()),
        Value::Array(array) => array
            .iter()
            .for_each(|value| remember_json_secrets(value, secrets)),
        Value::Object(object) => object
            .values()
            .for_each(|value| remember_json_secrets(value, secrets)),
        _ => {}
    }
}

pub fn finish(error: Option<&str>, failed_validation: bool) {
    let _ = SESSION.try_with(|session| {
        let mut session = session.borrow_mut();
        let Some(mut trace) = session.trace.take() else {
            return;
        };
        trace.entry.duration_ms = trace.start.elapsed().as_millis();
        trace.entry.failure = match error {
            Some("Execução cancelada.") => Some("cancelled"),
            Some("A requisição excedeu o timeout configurado.") => Some("timeout"),
            Some(_) => trace.entry.failure,
            None if failed_validation => Some("validation"),
            None => None,
        };
        if let Some(response) = &mut trace.entry.response {
            let mut preview_bytes = trace.preview.as_slice();
            if (trace.truncated || error.is_some())
                && let Err(utf8) = std::str::from_utf8(preview_bytes)
                && utf8.error_len().is_none()
            {
                preview_bytes = &preview_bytes[..utf8.valid_up_to()];
            }
            let body = String::from_utf8_lossy(preview_bytes);
            let preview = if let Ok(mut json) = serde_json::from_str::<Value>(&body) {
                mask_json(&mut json, &mut trace.masks);
                serde_json::to_string_pretty(&json).unwrap_or_default()
            } else if !body.is_empty()
                && (trace.json_response || body.trim_start().starts_with(['{', '[']))
            {
                response.truncated = true;
                String::new()
            } else {
                body.into_owned()
            };
            let preview = redact(
                &preview,
                &trace.masks.values,
                trace.truncated || error.is_some(),
            );
            response.truncated |=
                trace.truncated || preview.len() > PREVIEW_LIMIT || error.is_some();
            response.preview = clip(preview, PREVIEW_LIMIT);
            for (name, value) in &mut response.headers {
                *name = clip(
                    redact(name, &trace.masks.values, name.len() >= FIELD_LIMIT - 3),
                    FIELD_LIMIT,
                );
                if value != MASK {
                    *value = clip(
                        redact(value, &trace.masks.values, value.len() >= FIELD_LIMIT - 3),
                        FIELD_LIMIT,
                    );
                }
            }
        }
        (session.report)(trace.entry);
    });
}
