use crate::{App, credentials, open_oauth_browser};
use fedexe_api_delivery::http::drive::{BackupPage, DesktopClient};
use tauri::State;
use tokio::sync::Mutex;

static OPERATION: Mutex<()> = Mutex::const_new(());
const DISCONNECTED: &str = "Conecte uma conta Google para acessar os backups.";
const INVALID: &str = "A configuração local do Google Drive está inválida.";
const UNAVAILABLE: &str = "O acesso ao Google Drive não foi configurado nesta versão.";

fn drive_enabled() -> bool {
    option_env!("VITE_FEDEXE_GOOGLE_DRIVE") == Some("true")
}

fn require_enabled() -> Result<(), String> {
    if drive_enabled() {
        Ok(())
    } else {
        Err(UNAVAILABLE.into())
    }
}

fn bundled_client() -> Option<DesktopClient> {
    let client_id = option_env!("FEDEXE_GOOGLE_OAUTH_CLIENT_ID")?.trim();
    let client_secret = option_env!("FEDEXE_GOOGLE_OAUTH_CLIENT_SECRET")?.trim();
    if client_id.is_empty() || client_secret.is_empty() {
        return None;
    }
    Some(DesktopClient {
        client_id: client_id.into(),
        client_secret: client_secret.into(),
    })
}

#[derive(serde::Serialize)]
pub struct DriveStatus {
    available: bool,
    connected: bool,
}

fn target() -> Vec<u16> {
    "FedexeApi:GoogleDrive:DesktopClient"
        .encode_utf16()
        .chain([0])
        .collect()
}

fn configured_client() -> Result<Option<DesktopClient>, String> {
    let Some(value) = credentials::read_target(target())? else {
        return Ok(None);
    };
    let saved: DesktopClient = serde_json::from_str(&value).map_err(|_| INVALID)?;
    Ok(Some(
        bundled_client()
            .filter(|bundled| bundled.client_id == saved.client_id)
            .unwrap_or(saved),
    ))
}

fn client() -> Result<DesktopClient, String> {
    configured_client()?.ok_or_else(|| DISCONNECTED.into())
}

#[tauri::command]
pub fn drive_status() -> Result<DriveStatus, String> {
    if !drive_enabled() {
        return Ok(DriveStatus {
            available: false,
            connected: false,
        });
    }
    let connected = configured_client()?.is_some();
    Ok(DriveStatus {
        available: connected || bundled_client().is_some(),
        connected,
    })
}

#[tauri::command]
pub async fn drive_connect(app: State<'_, App>) -> Result<(), String> {
    require_enabled()?;
    let _guard = OPERATION.lock().await;
    // Keep authorizing against the original project for an existing 1.8.0 connection.
    let client = configured_client()?
        .or_else(bundled_client)
        .ok_or(UNAVAILABLE)?;
    app.client
        .connect_drive(&client, open_oauth_browser)
        .await?;
    credentials::write_target(
        target(),
        Some(serde_json::to_string(&client).map_err(|_| INVALID)?),
    )
}

#[tauri::command]
pub async fn drive_disconnect(app: State<'_, App>) -> Result<(), String> {
    require_enabled()?;
    let _guard = OPERATION.lock().await;
    if let Some(client) = configured_client()? {
        app.client.disconnect_drive(&client).await?;
        credentials::write_target(target(), None)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn drive_list(app: State<'_, App>, page: Option<String>) -> Result<BackupPage, String> {
    require_enabled()?;
    let _guard = OPERATION.lock().await;
    app.client.list_drive(&client()?, page).await
}

#[tauri::command]
pub async fn drive_upload(app: State<'_, App>, contents: String) -> Result<(), String> {
    require_enabled()?;
    let _guard = OPERATION.lock().await;
    app.client.upload_drive(&client()?, contents).await
}

#[tauri::command]
pub async fn drive_download(app: State<'_, App>, id: String) -> Result<String, String> {
    require_enabled()?;
    let _guard = OPERATION.lock().await;
    app.client.download_drive(&client()?, id).await
}
