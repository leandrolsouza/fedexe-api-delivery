use serde::Serialize;
use std::time::Duration;
use tauri::{AppHandle, State, ipc::Channel};
use tauri_plugin_updater::{Error, Update, UpdaterBuilder, UpdaterExt};
use tokio::sync::Mutex;

#[derive(Default)]
pub(crate) struct PendingUpdate(Mutex<Option<Update>>);

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub(crate) enum CheckResult {
    Unconfigured,
    Current,
    Available {
        version: String,
        #[serde(rename = "localizedNotes")]
        localized_notes: LocalizedNotes,
    },
}

#[derive(Serialize)]
pub(crate) struct LocalizedNotes {
    #[serde(rename = "en-US")]
    english: Option<String>,
    #[serde(rename = "pt-BR")]
    portuguese: Option<String>,
}

impl LocalizedNotes {
    fn from_update(update: &Update) -> Self {
        let notes = &update.raw_json["localizedNotes"];
        let note = |locale: &str| {
            notes[locale]
                .as_str()
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .map(str::to_owned)
        };
        Self {
            english: note("en-US"),
            portuguese: note("pt-BR").or_else(|| update.body.clone()),
        }
    }
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
        let localized_notes = LocalizedNotes::from_update(&update);
        *slot = Some(update);
        Ok(CheckResult::Available {
            version,
            localized_notes,
        })
    } else {
        Ok(CheckResult::Current)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tauri::test::{mock_builder, mock_context, noop_assets};

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
        let mut release = manifest("1.1.1");
        release["notes"] = json!("• Melhorias no console\n• Correções no runner");
        let update = updater.restore_update(release.clone()).unwrap().unwrap();
        assert_eq!(
            update.body.as_deref(),
            Some("• Melhorias no console\n• Correções no runner")
        );
        let notes = LocalizedNotes::from_update(&update);
        assert_eq!(notes.portuguese, update.body);
        assert!(notes.english.is_none());
        release["localizedNotes"] =
            json!({ "en-US": "  English notes  ", "pt-BR": "Notas traduzidas" });
        let localized = updater.restore_update(release).unwrap().unwrap();
        let notes = serde_json::to_value(LocalizedNotes::from_update(&localized)).unwrap();
        assert_eq!(
            notes,
            json!({ "en-US": "English notes", "pt-BR": "Notas traduzidas" })
        );
        update.verify(payload).unwrap();
        assert!(matches!(
            update.install(b"modified payload"),
            Err(Error::Minisign(_))
        ));
        let mismatched = updater.restore_update(manifest("1.1.2")).unwrap().unwrap();
        assert!(mismatched.body.is_none());
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
    .map_err(|error| {
        match error {
            Error::Minisign(_)
            | Error::Base64(_)
            | Error::SignatureUtf8(_)
            | Error::MissingSignedVersion
            | Error::SignedVersionMismatch { .. } => {
                "A assinatura do pacote não pôde ser validada. Baixe a versão oficial no GitHub Releases."
            }
            Error::Reqwest(_) | Error::Network(_) => {
                "Não foi possível baixar a atualização. Verifique a conexão e tente novamente."
            }
            _ => "Não foi possível iniciar o instalador. Tente novamente ou baixe a versão no GitHub Releases.",
        }
        .into()
    })
}
