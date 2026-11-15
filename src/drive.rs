use crate::{App, credentials, open_oauth_browser};
use fedexe_api_delivery::http::drive::{BackupPage, DesktopClient};
use tauri::State;
use tokio::sync::Mutex;

static OPERATION: Mutex<()> = Mutex::const_new(());
const DISCONNECTED: &str = "Conecte uma conta Google para acessar os backups.";
const INVALID: &str = "Informe as credenciais OAuth de um cliente desktop do Google.";

fn target() -> Vec<u16> {
    "FedexeApi:GoogleDrive:DesktopClient"
        .encode_utf16()
        .chain([0])
        .collect()
}

fn configured_client() -> Result<Option<DesktopClient>, String> {
    credentials::read_target(target())?
        .map(|value| serde_json::from_str(&value).map_err(|_| INVALID.into()))
        .transpose()
}

fn client() -> Result<DesktopClient, String> {
    configured_client()?.ok_or_else(|| DISCONNECTED.into())
}

#[tauri::command]
pub fn drive_status() -> Result<bool, String> {
    Ok(configured_client()?.is_some())
}

#[tauri::command]
pub async fn drive_connect(app: State<'_, App>, client: DesktopClient) -> Result<(), String> {
    let _guard = OPERATION.lock().await;
    if client.client_id.trim().is_empty() || client.client_secret.trim().is_empty() {
        return Err(INVALID.into());
    }
    let previous = configured_client()?;
    app.client
        .connect_drive(&client, open_oauth_browser)
        .await?;
    if let Some(previous) = previous.filter(|previous| previous.client_id != client.client_id) {
        app.client.disconnect_drive(&previous).await?;
    }
    credentials::write_target(
        target(),
        Some(serde_json::to_string(&client).map_err(|_| INVALID)?),
    )
}

#[tauri::command]
pub async fn drive_disconnect(app: State<'_, App>) -> Result<(), String> {
    let _guard = OPERATION.lock().await;
    if let Some(client) = configured_client()? {
        app.client.disconnect_drive(&client).await?;
        credentials::write_target(target(), None)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn drive_list(app: State<'_, App>, page: Option<String>) -> Result<BackupPage, String> {
    let _guard = OPERATION.lock().await;
    app.client.list_drive(&client()?, page).await
}

#[tauri::command]
pub async fn drive_upload(app: State<'_, App>, contents: String) -> Result<(), String> {
    let _guard = OPERATION.lock().await;
    app.client.upload_drive(&client()?, contents).await
}

#[tauri::command]
pub async fn drive_download(app: State<'_, App>, id: String) -> Result<String, String> {
    let _guard = OPERATION.lock().await;
    app.client.download_drive(&client()?, id).await
}
