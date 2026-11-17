use std::{fs, path::PathBuf, thread, time::Duration};

fn directory() -> PathBuf {
    std::env::var_os("FEDEXE_UPDATER_QA_DIR").expect("QA directory").into()
}

#[tauri::command]
pub fn result(id: u32, json: String) -> Result<(), String> {
    let dir = directory();
    let temporary = dir.join(format!("result-{id}.tmp"));
    fs::write(&temporary, json).and_then(|()| fs::rename(temporary, dir.join(format!("result-{id}.json"))))
        .map_err(|error| error.to_string())
}

pub fn bridge(window: tauri::WebviewWindow) {
    if std::env::var_os("FEDEXE_UPDATER_QA_DIR").is_none() {
        return;
    }
    let dir = directory();
    thread::spawn(move || {
        for id in 1.. {
            let input = dir.join(format!("request-{id}.js"));
            let code = loop {
                if let Ok(code) = fs::read_to_string(&input) {
                    break code;
                }
                thread::sleep(Duration::from_millis(30));
            };
            let script = format!(
                r#"void (async () => {{
                  let result;
                  try {{ result = {{ value: await ({code}) }}; }}
                  catch (error) {{ result = {{ error: String(error) }}; }}
                  await window.__TAURI__.core.invoke('result', {{ id: {id}, json: JSON.stringify(result) }});
                }})();"#,
            );
            // The fixture app can be evaluating its startup scripts or reloading the page.
            loop {
                if window.eval(&script).is_err() {
                    return;
                }
                thread::sleep(Duration::from_millis(350));
                if dir.join(format!("result-{id}.json")).exists() {
                    break;
                }
            }
        }
    });
}

pub fn read_fixture_secret() -> bool {
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() != Some("--qa-read-secret") {
        return false;
    }
    let env = args.next().expect("fixture environment");
    let value = crate::credentials::read_secret(env, "FEDExE_QA".into(), None).expect("read the fixture secret");
    fs::write(directory().join("vault.json"), serde_json::to_string(&value).unwrap()).expect("write fixture result");
    true
}
