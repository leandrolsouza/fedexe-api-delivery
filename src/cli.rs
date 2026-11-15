use fedexe_api_delivery::http::{self, Clients, Collection};
use std::{io, process::ExitCode};

fn main() -> ExitCode {
    let result = tauri::async_runtime::block_on(async {
        let collection: Collection = serde_json::from_reader(io::stdin().lock()).ok()?;
        let clients = Clients::new().ok()?;
        let (_sender, receiver) = tokio::sync::oneshot::channel();
        http::run(&clients, collection, receiver, |_| {}).await.ok()
    });
    let Some(run) = result else {
        return ExitCode::from(2);
    };
    let (exit_code, report) = run.cli_report();
    if serde_json::to_writer(io::stdout().lock(), &report).is_err() {
        return ExitCode::from(2);
    }
    ExitCode::from(exit_code)
}
