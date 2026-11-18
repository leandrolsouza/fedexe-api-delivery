#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(windows)]
mod credentials;
#[cfg(windows)]
mod drive;
mod local_ai;
#[cfg(windows)]
mod postman;
#[cfg(windows)]
mod updates;
mod workspace;

use fedexe_api_delivery::http::{self, Collection, Request, Response, Run};
use std::{
    collections::{BTreeMap, HashMap},
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
    runner_cookies: Mutex<Arc<http::CookieSession>>,
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

#[derive(serde::Deserialize)]
struct RunnerStep {
    index: usize,
    variables: BTreeMap<String, String>,
    capture_body: bool,
    #[serde(default)]
    extract: BTreeMap<String, String>,
}

#[tauri::command]
async fn send(
    app: State<'_, App>,
    request: Request,
    runner_step: Option<RunnerStep>,
    use_runner_cookies: Option<bool>,
    hide_response_details: Option<bool>,
    console: tauri::ipc::Channel<http::console::Entry>,
) -> Result<Response, String> {
    let mut response = app
        .execute(|receiver| {
            http::console::observe(
                move |entry| {
                    let _ = console.send(entry);
                },
                async {
                    http::console::start(runner_step.as_ref().map(|step| step.index + 1));
                    let result = tokio::select! {
                        biased;
                        _ = receiver => Err("Execução cancelada.".into()),
                        result = async {
                            let runner_cookies = app.runner_cookies.lock().unwrap().clone();
                            match runner_step {
                                Some(step) => {
                                    let response = http::send_runner_step(
                                        &app.client, &runner_cookies, request, step.variables, step.capture_body,
                                    ).await;
                                    if !step.extract.is_empty() {
                                        match &response {
                                            Ok(response) => {
                                                http::mask_runner_response(response, &step.extract);
                                            }
                                            Err(_) => http::console::hide_response_details(),
                                        }
                                    }
                                    response
                                }
                                None if use_runner_cookies.unwrap_or_default() => {
                                    http::send_in_session(&app.client, &runner_cookies, request).await
                                }
                                None => http::send(&app.client, request).await,
                            }
                        } => result,
                    };
                    if hide_response_details.unwrap_or_default() {
                        http::console::hide_response_details();
                    }
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
fn clear_session_cookies(app: State<'_, App>) {
    app.client.clear_session_cookies();
}

#[tauri::command]
fn reset_runner_cookies(app: State<'_, App>) {
    *app.runner_cookies.lock().unwrap() = Arc::default();
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
async fn check_backup_attachments(
    paths: Vec<std::path::PathBuf>,
) -> Result<Vec<Option<bool>>, String> {
    use std::path::{Component, Prefix};

    tauri::async_runtime::spawn_blocking(move || {
        paths
            .iter()
            .map(|path| match path.components().next() {
                Some(Component::Prefix(prefix))
                    if !matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_)) =>
                {
                    None
                }
                _ => Some(
                    path.is_absolute()
                        && std::fs::metadata(path).is_ok_and(|metadata| metadata.is_file()),
                ),
            })
            .collect()
    })
    .await
    .map_err(|error| error.to_string())
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
async fn run_load(
    app: State<'_, App>,
    collection: Collection,
    options: http::load::Options,
    progress: tauri::ipc::Channel<http::load::Metrics>,
) -> Result<http::load::Report, String> {
    app.execute(|receiver| {
        http::load::run(&app.client, collection, options, receiver, move |metrics| {
            let _ = progress.send(metrics);
        })
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

#[cfg(windows)]
#[tauri::command]
async fn oauth_connect(app: State<'_, App>, provider: http::oauth::Provider) -> Result<(), String> {
    app.client.connect_oauth(provider, open_oauth_browser).await
}

#[cfg(windows)]
fn open_oauth_browser(url: &url::Url) -> Result<(), String> {
    open_in_browser(url.as_str())
        .map_err(|_| "Não foi possível abrir o navegador para a autorização OAuth 2.0.".into())
}

#[cfg(windows)]
#[tauri::command]
fn open_release_notes() -> Result<(), String> {
    open_in_browser("https://github.com/leandrolsouza/fedexe-api-delivery/releases")
        .map_err(|_| "Não foi possível abrir as notas da versão.".into())
}

#[cfg(windows)]
fn open_in_browser(url: &str) -> Result<(), ()> {
    use std::ptr::null;
    use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};
    let url: Vec<u16> = url.encode_utf16().chain([0]).collect();
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            null(),
            url.as_ptr(),
            null(),
            null(),
            SW_SHOWNORMAL,
        )
    };
    if result as isize <= 32 {
        return Err(());
    }
    Ok(())
}

#[cfg(windows)]
#[tauri::command]
async fn oauth_disconnect(
    app: State<'_, App>,
    provider: http::oauth::Provider,
) -> Result<(), String> {
    app.client.disconnect_oauth(provider).await
}

fn main() {
    let client = http::Clients::new().expect("HTTP clients");

    #[cfg(windows)]
    let client = client.with_oauth_vault(credentials::oauth_vault());

    let builder = tauri::Builder::default();
    #[cfg(windows)]
    let builder = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updates::PendingUpdate::default())
        .on_tray_icon_event(|app, event| {
            use tauri::{
                Manager,
                tray::{MouseButton, MouseButtonState, TrayIconEvent},
            };

            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) && let Some(window) = app.get_webview_window("main")
            {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        });
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
            runner_cookies: Mutex::default(),
            active: Mutex::new(None),
            bodies: Mutex::new(HashMap::new()),
            next_body: AtomicU64::new(0),
        })
        .invoke_handler(tauri::generate_handler![
            send,
            clear_session_cookies,
            reset_runner_cookies,
            run,
            run_load,
            cancel,
            release_response_bodies,
            #[cfg(windows)]
            save_response_body,
            #[cfg(windows)]
            pick_body_file,
            check_backup_attachments,
            local_ai::ai_list_models,
            local_ai::ai_test_model,
            workspace::load_workspace,
            workspace::save_workspace,
            workspace::list_workspaces,
            workspace::delete_workspace,
            #[cfg(windows)]
            credentials::read_secret,
            #[cfg(windows)]
            credentials::write_secret,
            #[cfg(windows)]
            oauth_connect,
            #[cfg(windows)]
            oauth_disconnect,
            drive::drive_status,
            drive::drive_connect,
            drive::drive_disconnect,
            drive::drive_list,
            drive::drive_upload,
            drive::drive_download,
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
            #[cfg(windows)]
            open_release_notes,
        ])
        .run(tauri::generate_context!())
        .expect("Fedexe API");
}
