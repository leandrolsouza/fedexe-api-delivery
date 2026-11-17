use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

fn valid_id(id: &str) -> bool {
    id.len() == 36
        && id.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                byte == b'-'
            } else {
                byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)
            }
        })
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|error| error.to_string())
}

fn path(dir: &Path, workspace_id: Option<&str>) -> Result<PathBuf, String> {
    match workspace_id {
        None => Ok(dir.join("workspace.json")),
        Some(id) if valid_id(id) => Ok(dir.join("workspaces").join(format!("{id}.json"))),
        Some(_) => Err("Identificador de workspace inválido.".into()),
    }
}

#[tauri::command]
pub fn list_workspaces(app: AppHandle) -> Result<Vec<WorkspaceSummary>, String> {
    discover_workspaces(&data_dir(&app)?).map_err(|error| error.to_string())
}

fn discover_workspaces(dir: &Path) -> io::Result<Vec<WorkspaceSummary>> {
    let entries = match fs::read_dir(dir.join("workspaces")) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };
    let mut workspaces = Vec::new();
    for entry in entries {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }
        if let Some(id) = entry
            .file_name()
            .to_str()
            .and_then(|name| name.strip_suffix(".json"))
        {
            if valid_id(id) {
                let name = fs::read_to_string(entry.path())
                    .ok()
                    .and_then(|contents| serde_json::from_str::<serde_json::Value>(&contents).ok())
                    .and_then(|data| {
                        data["settings"]["workspaceName"]
                            .as_str()
                            .map(str::to_owned)
                    });
                workspaces.push(WorkspaceSummary {
                    id: id.to_owned(),
                    name,
                });
            }
        }
    }
    Ok(workspaces)
}

#[derive(serde::Serialize)]
pub struct WorkspaceSummary {
    id: String,
    name: Option<String>,
}

#[tauri::command]
pub fn load_workspace(
    app: AppHandle,
    workspace_id: Option<String>,
) -> Result<Option<String>, String> {
    match fs::read_to_string(path(&data_dir(&app)?, workspace_id.as_deref())?) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub async fn save_workspace(
    app: AppHandle,
    contents: String,
    workspace_id: Option<String>,
) -> Result<(), String> {
    let path = path(&data_dir(&app)?, workspace_id.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || write_atomic(&path, &contents))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

fn write_atomic(path: &Path, contents: &str) -> io::Result<()> {
    let directory = path.parent().expect("workspace path has a parent");
    fs::create_dir_all(directory)?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary = directory.join(format!("workspace-{}-{timestamp}.tmp", std::process::id()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)?;
    let written = file
        .write_all(contents.as_bytes())
        .and_then(|()| file.sync_all());
    drop(file);
    let result = written.and_then(|()| fs::rename(&temporary, path));
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovers_additional_workspaces_without_replacing_the_original() {
        let dir = std::env::temp_dir().join(format!("fedexe-workspaces-{}", std::process::id()));
        let original = path(&dir, None).unwrap();
        let id = "a2123456-1234-4321-a123-b01234567890";
        let additional = path(&dir, Some(id)).unwrap();
        let legacy = r#"{"version":1,"collections":[{"name":"Legacy"}]}"#;
        write_atomic(&original, legacy).unwrap();
        assert!(discover_workspaces(&dir).unwrap().is_empty());
        write_atomic(
            &additional,
            r#"{"settings":{"workspaceName":"Other project"}}"#,
        )
        .unwrap();
        write_atomic(&dir.join("workspaces").join("backup.json"), "{}").unwrap();

        assert!(path(&dir, Some("../workspace")).is_err());
        assert_eq!(fs::read_to_string(original).unwrap(), legacy);
        let workspaces = discover_workspaces(&dir).unwrap();
        assert_eq!(workspaces.len(), 1);
        assert_eq!(workspaces[0].id, id);
        assert_eq!(workspaces[0].name.as_deref(), Some("Other project"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn creates_and_replaces_workspace() {
        let directory =
            std::env::temp_dir().join(format!("fedexe-workspace-test-{}", std::process::id()));
        let path = directory.join("workspace.json");
        write_atomic(&path, r#"{"version":1}"#).unwrap();
        write_atomic(&path, r#"{"version":1,"collections":[]}"#).unwrap();
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            r#"{"version":1,"collections":[]}"#
        );
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
        fs::remove_file(path).unwrap();
        fs::remove_dir(directory).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn preserves_saved_workspace_when_windows_blocks_replacement() {
        use std::os::windows::fs::OpenOptionsExt;

        let directory =
            std::env::temp_dir().join(format!("fedexe-workspace-locked-{}", std::process::id()));
        let path = directory.join("workspace.json");
        let saved = r#"{"version":1,"collections":[{"name":"Saved"}]}"#;
        let changed = r#"{"version":1,"collections":[{"name":"Changed"}]}"#;
        write_atomic(&path, saved).unwrap();

        // Allow readers to reopen the workspace while denying rename and deletion.
        const FILE_SHARE_READ: u32 = 1;
        let lock = OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ)
            .open(&path)
            .unwrap();

        assert!(write_atomic(&path, changed).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), saved);
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);

        drop(lock);
        write_atomic(&path, changed).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), changed);
        fs::remove_dir_all(directory).unwrap();
    }
}
