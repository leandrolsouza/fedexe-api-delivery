use serde::Serialize;
use std::time::Duration;
use tauri::{AppHandle, State, ipc::Channel};
use tauri_plugin_updater::{Update, UpdaterBuilder, UpdaterExt};
use tokio::sync::Mutex;

#[derive(Default)]
pub(crate) struct PendingUpdate(Mutex<Option<Update>>);

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub(crate) enum CheckResult {
    Unconfigured,
    Current,
    Available { version: String },
}

fn stable_channel(builder: UpdaterBuilder) -> UpdaterBuilder {
    builder.version_comparator(|current, release| {
        release.version.pre.is_empty() && release.version > current
    })
}

#[tauri::command]
pub(crate) async fn check_update(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
) -> Result<CheckResult, String> {
    let mut slot = pending
        .0
        .try_lock()
        .map_err(|_| "O atualizador está ocupado.")?;
    *slot = None;
    if app
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|config| config.get("pubkey"))
        .and_then(|key| key.as_str())
        .is_none_or(|key| key.trim().is_empty())
    {
        return Ok(CheckResult::Unconfigured);
    }
    let update = stable_channel(app.updater_builder())
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| "Não foi possível iniciar o atualizador.")?
        .check()
        .await
        .map_err(
            |_| "Não foi possível consultar as atualizações. Tente novamente em Configurações.",
        )?;

    if let Some(mut update) = update {
        update.timeout = Some(Duration::from_secs(180));
        let version = update.version.clone();
        *slot = Some(update);
        Ok(CheckResult::Available { version })
    } else {
        Ok(CheckResult::Current)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tauri::test::{mock_builder, mock_context, noop_assets};
    use tauri_plugin_updater::Error;

    #[test]
    fn accepts_only_new_stable_versions_and_verifies_the_signed_package() {
        let mut context = mock_context(noop_assets());
        context.package_info_mut().version = "1.1.0".parse().unwrap();
        context.config_mut().plugins.0.insert(
            "updater".into(),
            json!({
                "pubkey": include_str!("update-fixtures/test.pub").trim(),
                "endpoints": ["https://example.invalid/latest.json"],
                "requireSignedVersion": true
            }),
        );
        let app = mock_builder()
            .plugin(tauri_plugin_updater::Builder::new().build())
            .build(context)
            .unwrap();
        let updater = stable_channel(app.updater_builder())
            .target("windows-x86_64")
            .build()
            .unwrap();
        let manifest = |version| {
            json!({
                "version": version,
                "platforms": { "windows-x86_64": {
                    "url": "https://example.invalid/fedexe-setup.exe",
                    "signature": include_str!("update-fixtures/package.sig").trim()
                }}
            })
        };
        for version in ["1.0.9", "1.1.0", "1.2.0-rc.1"] {
            assert!(updater.restore_update(manifest(version)).unwrap().is_none());
        }
        let payload = b"Fedexe updater signature test fixture";
        let update = updater.restore_update(manifest("1.1.1")).unwrap().unwrap();
        update.verify(payload).unwrap();
        assert!(matches!(
            update.install(b"modified payload"),
            Err(Error::Minisign(_))
        ));
        let mismatched = updater.restore_update(manifest("1.1.2")).unwrap().unwrap();
        assert!(matches!(
            mismatched.verify(payload),
            Err(Error::SignedVersionMismatch { .. })
        ));
    }
}

#[tauri::command]
pub(crate) async fn install_update(
    pending: State<'_, PendingUpdate>,
    version: String,
    progress: Channel<&'static str>,
) -> Result<(), String> {
    let slot = pending
        .0
        .try_lock()
        .map_err(|_| "O atualizador está ocupado.")?;
    let update = slot
        .as_ref()
        .filter(|update| update.version == version)
        .ok_or("Verifique novamente se há atualizações.")?;

    // Tauri verifica a assinatura antes de iniciar o instalador e encerrar o app.
    update.download_and_install(
        |_, _| {},
        || { let _ = progress.send("Verificando assinatura e preparando a instalação…"); },
    )
    .await
    .map_err(|_| "Não foi possível baixar, verificar ou instalar o pacote. Tente novamente ou baixe a versão no GitHub Releases.".into())
}
