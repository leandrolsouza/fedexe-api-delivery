use super::{Clients, oauth::Provider};
use reqwest::{Response, Url, header::AUTHORIZATION};
use serde::{Deserialize, Serialize};
use std::time::Duration;

const NAME: &str = "fedexe-workspace-backup.json";
const LIMIT: usize = 5_000_000;
const FAILED: &str = "Não foi possível concluir a operação no Google Drive.";
const TOO_LARGE: &str = "O backup excede o limite de 5 MB.";

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopClient {
    pub client_id: String,
    pub client_secret: String,
}

impl DesktopClient {
    fn provider(&self) -> Provider {
        Provider {
            authorization_url: "https://accounts.google.com/o/oauth2/v2/auth".into(),
            token_url: "https://oauth2.googleapis.com/token".into(),
            client_id: self.client_id.clone(),
            scope: "https://www.googleapis.com/auth/drive.appdata".into(),
        }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
    id: String,
    created_time: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupPage {
    #[serde(default)]
    files: Vec<Backup>,
    next_page_token: Option<String>,
}

impl Clients {
    pub async fn connect_drive(
        &self,
        client: &DesktopClient,
        open_browser: impl FnOnce(&Url) -> Result<(), String>,
    ) -> Result<(), String> {
        self.oauth
            .connect_pkce(
                &self.direct,
                client.provider(),
                Some(&client.client_secret),
                open_browser,
            )
            .await
    }

    pub async fn disconnect_drive(&self, client: &DesktopClient) -> Result<(), String> {
        self.oauth.disconnect_pkce(client.provider(), true).await
    }

    async fn drive_request(
        &self,
        method: reqwest::Method,
        url: Url,
        client: &DesktopClient,
    ) -> Result<reqwest::RequestBuilder, String> {
        let bearer = self
            .oauth
            .google_bearer(&self.direct, &client.provider(), &client.client_secret)
            .await
            .map_err(|_| "Reconecte a conta Google para acessar os backups.")?;
        Ok(self
            .direct
            .request(method, url)
            .header(AUTHORIZATION, bearer)
            .timeout(Duration::from_secs(60)))
    }

    pub async fn list_drive(
        &self,
        client: &DesktopClient,
        page: Option<String>,
    ) -> Result<BackupPage, String> {
        let mut url = Url::parse("https://www.googleapis.com/drive/v3/files").unwrap();
        let query = format!("name = '{NAME}' and trashed = false");
        url.query_pairs_mut().extend_pairs([
            ("spaces", "appDataFolder"),
            ("q", &query),
            ("fields", "nextPageToken,files(id,createdTime)"),
            ("orderBy", "createdTime desc"),
            ("pageSize", "50"),
        ]);
        if let Some(page) = page {
            url.query_pairs_mut().append_pair("pageToken", &page);
        }
        let request = self
            .drive_request(reqwest::Method::GET, url, client)
            .await?;
        let bytes = read(send(request).await?, 256 * 1024).await?;
        serde_json::from_slice(&bytes).map_err(|_| FAILED.into())
    }

    pub async fn upload_drive(
        &self,
        client: &DesktopClient,
        contents: String,
    ) -> Result<(), String> {
        if contents.len() > LIMIT {
            return Err(TOO_LARGE.into());
        }
        let url =
            Url::parse("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart")
                .unwrap();
        let metadata = serde_json::json!({"name": NAME, "parents": ["appDataFolder"], "mimeType": "application/json"});
        // Drive requires multipart/related rather than multipart/form-data.
        let boundary = format!("fedexe-{}", random_boundary()?);
        let body = format!(
            "--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n--{boundary}\r\nContent-Type: application/json\r\n\r\n{contents}\r\n--{boundary}--\r\n"
        );
        let request = self
            .drive_request(reqwest::Method::POST, url, client)
            .await?
            .header(
                reqwest::header::CONTENT_TYPE,
                format!("multipart/related; boundary={boundary}"),
            )
            .body(body);
        send(request).await?;
        Ok(())
    }

    pub async fn download_drive(
        &self,
        client: &DesktopClient,
        id: String,
    ) -> Result<String, String> {
        let mut url = Url::parse("https://www.googleapis.com/drive/v3/files/").unwrap();
        url.path_segments_mut().unwrap().pop_if_empty().push(&id);
        url.query_pairs_mut().append_pair("alt", "media");
        let request = self
            .drive_request(reqwest::Method::GET, url, client)
            .await?;
        let bytes = read(send(request).await?, LIMIT).await?;
        String::from_utf8(bytes).map_err(|_| FAILED.into())
    }
}

fn random_boundary() -> Result<String, String> {
    use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
    let mut bytes = [0; 24];
    getrandom::fill(&mut bytes).map_err(|_| FAILED)?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

async fn send(request: reqwest::RequestBuilder) -> Result<Response, String> {
    let response = request.send().await.map_err(|_| FAILED)?;
    if response.status().is_success() {
        Ok(response)
    } else {
        Err(FAILED.into())
    }
}

async fn read(mut response: Response, limit: usize) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| FAILED)? {
        if bytes.len() + chunk.len() > limit {
            return Err(TOO_LARGE.into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
