use reqwest::{Client, StatusCode, header::HeaderValue, redirect::Policy};
use serde::Deserialize;
use serde_json::Value;
use std::time::Duration;
use url::Url;

const ORIGIN: &str = "https://api.postman.com/";
const TARGET: &str = "app.fedexe.api/integrations/postman";
const MAX_BYTES: usize = 10 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Resource {
    Workspaces { cursor: Option<String> },
    Workspace { id: String },
    Specs { id: String, cursor: Option<String> },
    Spec { id: String },
    Collection { id: String },
    Environment { id: String },
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

fn resource_url(resource: Resource) -> Result<Url, String> {
    let mut page = None;
    let mut workspace_id = None;
    let mut definition = false;
    let (group, id) = match resource {
        Resource::Workspaces { cursor } => {
            page = Some(cursor);
            ("workspaces", None)
        }
        Resource::Workspace { id } => ("workspaces", Some(id)),
        Resource::Specs { id, cursor } => {
            workspace_id = Some(id);
            page = Some(cursor);
            ("specs", None)
        }
        Resource::Spec { id } => {
            definition = true;
            ("specs", Some(id))
        }
        Resource::Collection { id } => ("collections", Some(id)),
        Resource::Environment { id } => ("environments", Some(id)),
    };
    let mut url = Url::parse(ORIGIN).expect("Postman API origin");
    let mut path = url.path_segments_mut().expect("Postman API path");
    path.pop_if_empty().push(group);
    if let Some(id) = id {
        if !valid_id(&id) {
            return Err("invalidId".into());
        }
        path.push(&id);
    }
    if definition {
        path.push("definitions");
    }
    drop(path);
    if let Some(id) = workspace_id {
        if !valid_id(&id) {
            return Err("invalidId".into());
        }
        url.query_pairs_mut().append_pair("workspaceId", &id);
    }
    if let Some(cursor) = page {
        let mut query = url.query_pairs_mut();
        query.append_pair("limit", "100");
        if let Some(cursor) = cursor {
            if cursor.is_empty() || cursor.len() > 2048 {
                return Err("invalidResponse".into());
            }
            query.append_pair("cursor", &cursor);
        }
    }
    Ok(url)
}

fn target() -> Vec<u16> {
    TARGET.encode_utf16().chain([0]).collect()
}

#[tauri::command]
pub fn postman_has_key() -> Result<bool, String> {
    crate::credentials::read_target(target())
        .map(|key| key.is_some())
        .map_err(|_| "vault".into())
}

#[tauri::command]
pub fn postman_remove_key() -> Result<(), String> {
    crate::credentials::write_target(target(), None).map_err(|_| "vault".into())
}

#[tauri::command]
pub async fn postman_connect(key: String) -> Result<Value, String> {
    let key = key.trim();
    let workspaces = get(Resource::Workspaces { cursor: None }, key).await?;
    if !workspaces.get("workspaces").is_some_and(Value::is_array) {
        return Err("invalidResponse".into());
    }
    crate::credentials::write_target(target(), Some(key.to_owned()))
        .map_err(|_| "vault".to_string())?;
    Ok(workspaces)
}

#[tauri::command]
pub async fn postman_get(resource: Resource) -> Result<Value, String> {
    let key = crate::credentials::read_target(target())
        .map_err(|_| "vault".to_string())?
        .ok_or("missingKey")?;
    get(resource, &key).await
}

async fn get(resource: Resource, key: &str) -> Result<Value, String> {
    if key.is_empty() || key.len() > 512 {
        return Err("unauthorized".into());
    }
    let mut key = HeaderValue::from_str(key).map_err(|_| "unauthorized")?;
    key.set_sensitive(true);
    let client = Client::builder()
        .redirect(Policy::none())
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| "network")?;
    let mut response = client
        .get(resource_url(resource)?)
        .header("X-Api-Key", key)
        .send()
        .await
        .map_err(|_| "network")?;
    match response.status() {
        StatusCode::UNAUTHORIZED => return Err("unauthorized".into()),
        StatusCode::FORBIDDEN => return Err("forbidden".into()),
        StatusCode::NOT_FOUND => return Err("notFound".into()),
        StatusCode::TOO_MANY_REQUESTS => return Err("rateLimit".into()),
        status if !status.is_success() => return Err("remote".into()),
        _ => {}
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "network")? {
        if chunk.len() > MAX_BYTES - body.len() {
            return Err("tooLarge".into());
        }
        body.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&body).map_err(|_| "invalidResponse".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_spec_routes() {
        assert_eq!(
            resource_url(Resource::Spec {
                id: "spec-123".into()
            })
            .unwrap()
            .as_str(),
            "https://api.postman.com/specs/spec-123/definitions"
        );
        assert_eq!(
            resource_url(Resource::Specs {
                id: "workspace-456".into(),
                cursor: Some("next+page".into()),
            })
            .unwrap()
            .as_str(),
            "https://api.postman.com/specs?workspaceId=workspace-456&limit=100&cursor=next%2Bpage"
        );
        assert!(
            resource_url(Resource::Spec {
                id: "../spec".into()
            })
            .is_err()
        );
    }

    #[test]
    fn accepts_postman_uids_and_rejects_paths() {
        assert_eq!(
            resource_url(Resource::Collection {
                id: "123-a1b2-3c4d".into()
            })
            .unwrap()
            .as_str(),
            "https://api.postman.com/collections/123-a1b2-3c4d"
        );
        for id in [
            "",
            "..",
            "../workspaces",
            "x?token=x",
            "https://example.org",
        ] {
            assert!(resource_url(Resource::Workspace { id: id.into() }).is_err());
        }
    }
}
