#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(windows)]
mod credentials;
#[cfg(windows)]
mod postman;
#[cfg(windows)]
mod updates;
mod workspace;

use fedexe_api_delivery::http::{self, Collection, Request, Response, Run};
use std::{
    collections::HashMap,
    fs::File,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};
use tauri::State;
use tokio::sync::oneshot;

struct App {
    client: http::Clients,
    active: Mutex<Option<oneshot::Sender<()>>>,
    bodies: Mutex<HashMap<String, Arc<Mutex<File>>>>,
    next_body: AtomicU64,
}

impl App {
    async fn execute<T, F: Future<Output = Result<T, String>>>(
        &self,
        work: impl FnOnce(oneshot::Receiver<()>) -> F,
    ) -> Result<T, String> {
        let (sender, receiver) = oneshot::channel();
        {
            let mut active = self.active.lock().unwrap();
            if active.is_some() {
                return Err("Já existe uma execução ativa.".into());
            }
            *active = Some(sender);
        }

        let result = work(receiver).await;
        *self.active.lock().unwrap() = None;
        result
    }
}

#[tauri::command]
async fn send(
    app: State<'_, App>,
    request: Request,
    console: tauri::ipc::Channel<http::console::Entry>,
) -> Result<Response, String> {
    let mut response = app
        .execute(|receiver| {
            http::console::observe(
                move |entry| {
                    let _ = console.send(entry);
                },
                async {
                    http::console::start(None);
                    let result = tokio::select! {
                        biased;
                        _ = receiver => Err("Execução cancelada.".into()),
                        result = http::send(&app.client, request) => result,
                    };
                    http::console::finish(result.as_ref().err().map(String::as_str), false);
                    result
                },
            )
        })
        .await?;
    #[cfg(windows)]
    if let Some(file) = response.body_file.take() {
        let id = app.next_body.fetch_add(1, Ordering::Relaxed).to_string();
        app.bodies
            .lock()
            .unwrap()
            .insert(id.clone(), Arc::new(Mutex::new(file)));
        response.body_id = Some(id);
    }
    Ok(response)
}

#[tauri::command]
fn release_response_bodies(app: State<'_, App>, ids: Vec<String>) {
    let mut bodies = app.bodies.lock().unwrap();
    for id in ids {
        bodies.remove(&id);
    }
}

#[cfg(windows)]
#[tauri::command]
async fn pick_body_file(
    window: tauri::WebviewWindow,
    title: String,
) -> Result<Option<std::path::PathBuf>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (sender, receiver) = oneshot::channel();
    window
        .dialog()
        .file()
        .set_parent(&window)
        .set_title(title)
        .pick_file(move |selection| {
            let _ = sender.send(selection);
        });
    receiver
        .await
        .map_err(|error| error.to_string())?
        .map(|path| path.into_path().map_err(|error| error.to_string()))
        .transpose()
}

#[cfg(windows)]
#[tauri::command]
async fn save_response_body(
    window: tauri::WebviewWindow,
    app: State<'_, App>,
    id: String,
    filename: String,
    title: String,
) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;

    let body = app
        .bodies
        .lock()
        .unwrap()
        .get(&id)
        .cloned()
        .ok_or("O corpo desta resposta não está mais disponível.")?;
    let (sender, receiver) = oneshot::channel();
    window
        .dialog()
        .file()
        .set_parent(&window)
        .set_title(title)
        .set_file_name(filename)
        .save_file(move |path| {
            let _ = sender.send(path);
        });
    let Some(path) = receiver.await.map_err(|e| e.to_string())? else {
        return Ok(false);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || http::save_body(&mut body.lock().unwrap(), &path))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
async fn run(
    app: State<'_, App>,
    collection: Collection,
    progress: tauri::ipc::Channel<serde_json::Value>,
    console: tauri::ipc::Channel<http::console::Entry>,
) -> Result<Run, String> {
    app.execute(|receiver| {
        http::console::observe(
            move |entry| {
                let _ = console.send(entry);
            },
            http::run(&app.client, collection, receiver, move |event| {
                if let Ok(message) = serde_json::to_value(event) {
                    let _ = progress.send(message);
                }
            }),
        )
    })
    .await
}

#[tauri::command]
fn cancel(app: State<'_, App>) {
    // Keep the slot occupied until the running future exits.
    if let Some(sender) = app.active.lock().unwrap().as_mut() {
        let (replacement, _) = oneshot::channel();
        let _ = std::mem::replace(sender, replacement).send(());
    }
}

fn main() {
    let client = http::Clients::new().expect("HTTP clients");

    let builder = tauri::Builder::default();
    #[cfg(windows)]
    let builder = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updates::PendingUpdate::default());
    builder
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            #[cfg(windows)]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    // Mica is optional: unsupported Windows versions keep the solid fallback.
                    let _ = window_vibrancy::apply_mica(&window, Some(false));
                }
            }
            #[cfg(not(windows))]
            let _ = app;
            Ok(())
        })
        .manage(App {
            client,
            active: Mutex::new(None),
            bodies: Mutex::new(HashMap::new()),
            next_body: AtomicU64::new(0),
        })
        .invoke_handler(tauri::generate_handler![
            send,
            run,
            cancel,
            release_response_bodies,
            #[cfg(windows)]
            save_response_body,
            #[cfg(windows)]
            pick_body_file,
            workspace::load_workspace,
            workspace::save_workspace,
            #[cfg(windows)]
            credentials::read_secret,
            #[cfg(windows)]
            credentials::write_secret,
            #[cfg(windows)]
            postman::postman_has_key,
            #[cfg(windows)]
            postman::postman_remove_key,
            #[cfg(windows)]
            postman::postman_connect,
            #[cfg(windows)]
            postman::postman_get,
            #[cfg(windows)]
            updates::check_update,
            #[cfg(windows)]
            updates::install_update,
        ])
        .run(tauri::generate_context!())
        .expect("Fedexe API");
}
