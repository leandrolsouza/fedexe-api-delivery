use fedexe_api_delivery::http::{self, Clients, Collection, load};
use serde::Deserialize;
use serde_json::Value;
use std::{io, process::ExitCode};

#[derive(Deserialize)]
struct LoadInput {
    collection: Collection,
    options: load::Options,
}

fn main() -> ExitCode {
    let result: Option<(u8, Value)> = tauri::async_runtime::block_on(async {
        let clients = Clients::new().ok()?;
        let (_sender, receiver) = tokio::sync::oneshot::channel();
        if std::env::args().nth(1).as_deref() == Some("load") {
            let input: LoadInput = serde_json::from_reader(io::stdin().lock()).ok()?;
            let report = load::run(
                &clients,
                input.collection,
                input.options,
                receiver,
                |metrics| {
                    if let Ok(line) = serde_json::to_string(&metrics) {
                        eprintln!("{line}");
                    }
                },
            )
            .await
            .ok()?;
            Some((report.exit_code, serde_json::to_value(report).ok()?))
        } else {
            let collection: Collection = serde_json::from_reader(io::stdin().lock()).ok()?;
            let run = http::run(&clients, collection, receiver, |_| {})
                .await
                .ok()?;
            Some(run.cli_report())
        }
    });
    let Some((exit_code, report)) = result else {
        return ExitCode::from(2);
    };
    if serde_json::to_writer(io::stdout().lock(), &report).is_err() {
        return ExitCode::from(2);
    }
    ExitCode::from(exit_code)
}
