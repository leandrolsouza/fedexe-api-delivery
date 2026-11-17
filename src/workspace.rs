use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

fn path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("workspace.json"))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn load_workspace(app: AppHandle) -> Result<Option<String>, String> {
    match fs::read_to_string(path(&app)?) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub async fn save_workspace(app: AppHandle, contents: String) -> Result<(), String> {
    let path = path(&app)?;
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
