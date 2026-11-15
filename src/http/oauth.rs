use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use reqwest::{Client, Url, header::HeaderValue};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    sync::Mutex,
};

const FAILED: &str =
    "O provedor OAuth 2.0 recusou a autenticação ou retornou uma resposta inválida.";
const CONFIG: &str =
    "Confira a configuração OAuth 2.0. Use HTTPS ou HTTP em um endereço de loopback.";
const RECONNECT: &str = "Conecte a sessão OAuth 2.0 pelo editor de autorização.";
const BUSY: &str = "Já existe uma operação OAuth 2.0 em andamento.";
const DESKTOP: &str = "Authorization Code com PKCE está disponível no app desktop.";

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Provider {
    pub authorization_url: String,
    pub token_url: String,
    pub client_id: String,
    pub scope: String,
}

#[derive(Deserialize)]
#[serde(tag = "grant", rename_all = "snake_case")]
pub(crate) enum Authorization {
    ClientCredentials {
        token_url: String,
        client_id: String,
        client_secret: String,
        scope: String,
        #[serde(default)]
        resolved: bool,
    },
    Pkce {
        provider: Provider,
    },
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    token_type: String,
    expires_in: Option<u64>,
    refresh_token: Option<String>,
}

#[derive(Deserialize, Serialize)]
struct Session {
    access_token: String,
    refresh_token: Option<String>,
    expires_at: Option<u64>,
}

impl Session {
    fn valid(&self) -> bool {
        self.expires_at.is_none_or(|expiry| expiry > now())
    }
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub(crate) fn validate_resource(url: &Url) -> Result<(), String> {
    if secure_transport(url) {
        Ok(())
    } else {
        Err("OAuth 2.0 exige HTTPS para enviar o token fora do loopback.".into())
    }
}

fn secure_transport(url: &Url) -> bool {
    url.scheme() == "https"
        || (url.scheme() == "http"
            && (matches!(url.host(), Some(url::Host::Ipv4(ip)) if ip.is_loopback())
                || matches!(url.host(), Some(url::Host::Ipv6(ip)) if ip.is_loopback())))
}

fn endpoint(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| CONFIG)?;
    if !secure_transport(&url)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(CONFIG.into());
    }
    Ok(url)
}

fn bearer(token: &str) -> Result<HeaderValue, String> {
    if token.is_empty()
        || !token
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-._~+/=".contains(&b))
    {
        return Err(FAILED.into());
    }
    let mut value = HeaderValue::from_str(&format!("Bearer {token}")).map_err(|_| FAILED)?;
    value.set_sensitive(true);
    Ok(value)
}

async fn exchange(
    client: &Client,
    url: Url,
    form: &[(&str, &str)],
    basic: Option<(&str, &str)>,
) -> Result<Session, String> {
    let body = url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(form.iter().copied())
        .finish();
    let mut request = client
        .post(url)
        .timeout(Duration::from_secs(30))
        .header(
            reqwest::header::CONTENT_TYPE,
            "application/x-www-form-urlencoded",
        )
        .header(reqwest::header::ACCEPT, "application/json")
        .body(body);
    if let Some((id, secret)) = basic {
        let encode = |value: &str| {
            url::form_urlencoded::byte_serialize(value.as_bytes()).collect::<String>()
        };
        request = request.basic_auth(encode(id), Some(encode(secret)));
    }
    let mut response = request.send().await.map_err(|_| FAILED)?;
    if !response.status().is_success() {
        return Err(FAILED.into());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| FAILED)? {
        if body.len() + chunk.len() > 64 * 1024 {
            return Err(FAILED.into());
        }
        body.extend_from_slice(&chunk);
    }
    let result: TokenResponse = serde_json::from_slice(&body).map_err(|_| FAILED)?;
    if !result.token_type.eq_ignore_ascii_case("bearer") {
        return Err(FAILED.into());
    }
    bearer(&result.access_token)?;
    Ok(Session {
        access_token: result.access_token,
        refresh_token: result.refresh_token.filter(|token| !token.is_empty()),
        expires_at: result
            .expires_in
            .map(|seconds| now().saturating_add(seconds)),
    })
}

pub struct Vault {
    pub read: fn(&str) -> Result<Option<String>, String>,
    pub write: fn(&str, Option<String>) -> Result<(), String>,
}

#[derive(Default)]
pub(crate) struct OAuth {
    pub(crate) vault: Option<Vault>,
    sessions: Mutex<HashMap<[u8; 32], Session>>,
    interactive: Mutex<()>,
}

impl Provider {
    fn key(&self) -> Result<String, String> {
        endpoint(&self.authorization_url)?;
        endpoint(&self.token_url)?;
        if self.client_id.trim().is_empty() {
            return Err(CONFIG.into());
        }
        Ok(format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(self).map_err(|_| CONFIG)?,)
        ))
    }
}

impl OAuth {
    pub(crate) async fn authorize(
        &self,
        client: &Client,
        auth: Authorization,
        expand: impl Fn(&str) -> Result<String, String>,
    ) -> Result<HeaderValue, String> {
        let session = match auth {
            Authorization::ClientCredentials {
                token_url,
                client_id,
                client_secret,
                scope,
                resolved,
            } => {
                let expand = |value: &str| {
                    if resolved {
                        Ok(value.to_owned())
                    } else {
                        expand(value)
                    }
                };
                let (url, id, secret, scope) = (
                    endpoint(&expand(&token_url)?)?,
                    expand(&client_id)?,
                    expand(&client_secret)?,
                    expand(&scope)?,
                );
                if id.trim().is_empty() || secret.is_empty() {
                    return Err(CONFIG.into());
                }
                super::console::secret(&secret);
                let key = Sha256::digest(
                    serde_json::to_vec(&(url.as_str(), &id, &secret, &scope))
                        .map_err(|_| CONFIG)?,
                )
                .into();
                let mut sessions = self.sessions.lock().await;
                if let Some(session) = sessions.get(&key).filter(|session| session.valid()) {
                    super::console::secret(&session.access_token);
                    return bearer(&session.access_token);
                }
                let mut form = vec![("grant_type", "client_credentials")];
                if !scope.is_empty() {
                    form.push(("scope", &scope));
                }
                let mut session = exchange(client, url, &form, Some((&id, &secret))).await?;
                session.refresh_token = None;
                super::console::secret(&session.access_token);
                let header = bearer(&session.access_token)?;
                if session.expires_at.is_some() && session.valid() {
                    if sessions.len() >= 32 {
                        sessions.clear();
                    }
                    sessions.insert(key, session);
                }
                return Ok(header);
            }
            Authorization::Pkce { provider } => {
                let vault = self.vault.as_ref().ok_or(DESKTOP)?;
                let key = provider.key()?;
                let _guard = self.interactive.try_lock().map_err(|_| BUSY)?;
                let data = (vault.read)(&key)?.ok_or(RECONNECT)?;
                let mut session: Session = serde_json::from_str(&data).map_err(|_| RECONNECT)?;
                if !session.valid() {
                    let refresh = session.refresh_token.as_deref().ok_or(RECONNECT)?;
                    let form = [
                        ("grant_type", "refresh_token"),
                        ("refresh_token", refresh),
                        ("client_id", &provider.client_id),
                    ];
                    let mut updated =
                        exchange(client, endpoint(&provider.token_url)?, &form, None).await?;
                    updated.refresh_token = updated.refresh_token.or(session.refresh_token);
                    save(vault, &key, &updated)?;
                    session = updated;
                }
                session
            }
        };
        super::console::secret(&session.access_token);
        if let Some(refresh) = &session.refresh_token {
            super::console::secret(refresh);
        }
        bearer(&session.access_token)
    }

    pub(crate) async fn connect(
        &self,
        client: &Client,
        provider: Provider,
        open_browser: impl FnOnce(&Url) -> Result<(), String>,
    ) -> Result<(), String> {
        let vault = self.vault.as_ref().ok_or(DESKTOP)?;
        let key = provider.key()?;
        let _guard = self.interactive.try_lock().map_err(|_| BUSY)?;
        let mut authorize = endpoint(&provider.authorization_url)?;
        let mut random = [0; 64];
        getrandom::fill(&mut random).map_err(|_| FAILED)?;
        let verifier = URL_SAFE_NO_PAD.encode(&random[..32]);
        let state = URL_SAFE_NO_PAD.encode(&random[32..]);
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .map_err(|_| FAILED)?;
        let redirect = format!(
            "http://{}/oauth/callback",
            listener.local_addr().map_err(|_| FAILED)?
        );
        let params = [
            ("response_type", "code"),
            ("client_id", &provider.client_id),
            ("redirect_uri", &redirect),
            ("state", &state),
            ("code_challenge", &challenge),
            ("code_challenge_method", "S256"),
        ];
        if authorize
            .query_pairs()
            .any(|(key, _)| key == "scope" || params.iter().any(|(name, _)| key == *name))
        {
            return Err(CONFIG.into());
        }
        authorize.query_pairs_mut().extend_pairs(params);
        if !provider.scope.is_empty() {
            authorize
                .query_pairs_mut()
                .append_pair("scope", &provider.scope);
        }
        open_browser(&authorize)?;
        let code = tokio::time::timeout(
            Duration::from_secs(180),
            receive_code(listener, &redirect, &state),
        )
        .await
        .map_err(|_| "O tempo para concluir a autorização OAuth 2.0 expirou.")??;
        let session = exchange(
            client,
            endpoint(&provider.token_url)?,
            &[
                ("grant_type", "authorization_code"),
                ("client_id", &provider.client_id),
                ("code", &code),
                ("redirect_uri", &redirect),
                ("code_verifier", &verifier),
            ],
            None,
        )
        .await?;
        save(vault, &key, &session)
    }

    pub(crate) async fn disconnect(&self, provider: Provider) -> Result<(), String> {
        let vault = self.vault.as_ref().ok_or(DESKTOP)?;
        let _guard = self.interactive.try_lock().map_err(|_| BUSY)?;
        (vault.write)(&provider.key()?, None)
    }
}

fn save(vault: &Vault, key: &str, session: &Session) -> Result<(), String> {
    (vault.write)(
        key,
        Some(serde_json::to_string(session).map_err(|_| FAILED)?),
    )
}

async fn receive_code(
    listener: TcpListener,
    redirect: &str,
    state: &str,
) -> Result<String, String> {
    let expected = Url::parse(redirect).map_err(|_| CONFIG)?;
    loop {
        let (mut stream, _) = listener.accept().await.map_err(|_| FAILED)?;
        let result = tokio::time::timeout(Duration::from_secs(2), async {
            let mut request = Vec::new();
            while request.len() < 8192 && !request.ends_with(b"\r\n\r\n") {
                request.push(stream.read_u8().await.ok()?);
            }
            let (line, _) = std::str::from_utf8(&request).ok()?.split_once("\r\n")?;
            let path = line.strip_prefix("GET ")?.split_once(" HTTP/")?.0;
            if !path.starts_with("/oauth/callback?") {
                return None;
            }
            let url = expected.join(path).ok()?;
            let mut params = BTreeMap::new();
            for (key, value) in url.query_pairs() {
                if params.insert(key, value).is_some() {
                    return None;
                }
            }
            if params.get("state")? != state {
                return None;
            }
            if params.contains_key("error") {
                return Some(Err(FAILED.into()));
            }
            Some(Ok(params
                .get("code")
                .filter(|code| !code.is_empty())?
                .to_string()))
        })
        .await
        .ok()
        .flatten();
        let (status, message) = match &result {
            Some(Ok(_)) => ("200 OK", "Return to Fedexe API to finish signing in."),
            _ => (
                "400 Bad Request",
                "OAuth callback rejected. Return to Fedexe API.",
            ),
        };
        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{message}",
            message.len()
        );
        let _ = tokio::time::timeout(
            Duration::from_secs(2),
            stream.write_all(response.as_bytes()),
        )
        .await;
        if let Some(result) = result {
            return result;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::http::{self, Clients};
    use base64::engine::general_purpose::STANDARD;
    use serde_json::{Value, json};
    use std::sync::Mutex as SyncMutex;
    use tokio::net::TcpStream;

    async fn read_request(stream: &mut TcpStream) -> (String, BTreeMap<String, String>, String) {
        let mut raw = Vec::new();
        while !raw.ends_with(b"\r\n\r\n") {
            raw.push(stream.read_u8().await.unwrap());
        }
        let text = String::from_utf8(raw).unwrap();
        let mut lines = text.split("\r\n");
        let path = lines.next().unwrap().split_whitespace().nth(1).unwrap();
        let headers: BTreeMap<_, _> = lines
            .filter_map(|line| line.split_once(": "))
            .map(|(name, value)| (name.to_ascii_lowercase(), value.to_owned()))
            .collect();
        let length = headers
            .get("content-length")
            .map_or(0, |value| value.parse().unwrap());
        let mut body = vec![0; length];
        stream.read_exact(&mut body).await.unwrap();
        (path.into(), headers, String::from_utf8(body).unwrap())
    }

    async fn reply(stream: &mut TcpStream, status: &str, body: Value) {
        let body = body.to_string();
        stream.write_all(format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        ).as_bytes()).await.unwrap();
    }

    #[test]
    fn client_credentials_runs_without_interaction_and_keeps_secrets_out_of_reports() {
        tauri::async_runtime::block_on(async {
            let provider = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let base = format!("http://{}", provider.local_addr().unwrap());
            let worker = tokio::spawn(async move {
                for expected in ["/token", "/resource", "/resource", "/token"] {
                    let (mut stream, _) = provider.accept().await.unwrap();
                    let (path, headers, body) = read_request(&mut stream).await;
                    assert_eq!(path, expected);
                    if path == "/resource" {
                        assert_eq!(headers["authorization"], "Bearer fixture-access");
                        reply(&mut stream, "200 OK", json!({"echo": "fixture-access"})).await;
                    } else {
                        assert_eq!(body, "grant_type=client_credentials&scope=read+write");
                        let valid =
                            format!("Basic {}", STANDARD.encode("ci%3Aid:fixture%2Bsecret"));
                        if headers["authorization"] == valid {
                            reply(&mut stream, "200 OK", json!({
                                "access_token": "fixture-access", "token_type": "bearer", "expires_in": 3600
                            })).await;
                        } else {
                            reply(
                                &mut stream,
                                "401 Unauthorized",
                                json!({"error": "fixture-bad-secret"}),
                            )
                            .await;
                        }
                    }
                }
            });
            let request = |secret| {
                json!({
                    "method": "GET", "url": format!("{base}/resource"),
                    "oauth": { "grant": "client_credentials", "token_url": format!("{base}/token"),
                        "client_id": "ci:id", "client_secret": secret, "scope": "read write" }
                })
            };
            let collection = serde_json::from_value(json!({
                "variables": {"client_secret": "fixture+secret"},
                "requests": [
                    {"name": "first", "request": request("{{client_secret}}"), "tests": [{"type": "status", "equals": 200}]},
                    {"name": "cached", "request": request("{{client_secret}}")},
                    {"name": "rejected", "request": request("fixture-bad-secret")}
                ]
            })).unwrap();
            let (sender, cancel) = tokio::sync::oneshot::channel();
            let traces = std::sync::Arc::new(SyncMutex::new(Vec::new()));
            let captured = traces.clone();
            let clients = Clients::new().unwrap();
            let run = tokio::time::timeout(
                Duration::from_secs(10),
                http::console::observe(
                    move |entry| captured.lock().unwrap().push(entry),
                    http::run(&clients, collection, cancel, |_| {}),
                ),
            )
            .await
            .unwrap()
            .unwrap();
            drop(sender);
            worker.await.unwrap();
            let report = serde_json::to_string(&run).unwrap();
            assert_eq!(report.matches("\"status\":200").count(), 2);
            assert!(report.contains(FAILED));
            let console = serde_json::to_string(&*traces.lock().unwrap()).unwrap();
            for value in ["fixture-access", "fixture+secret", "fixture-bad-secret"] {
                assert!(!report.contains(value));
                assert!(!console.contains(value));
                #[cfg(feature = "cli")]
                assert!(!run.cli_report().1.to_string().contains(value));
            }
            #[cfg(feature = "cli")]
            assert_eq!(run.cli_report().0, 2);
        });
    }

    static VAULT: SyncMutex<Option<String>> = SyncMutex::new(None);

    fn test_vault() -> Vault {
        Vault {
            read: |_| Ok(VAULT.lock().unwrap().clone()),
            write: |_, value| {
                *VAULT.lock().unwrap() = value;
                Ok(())
            },
        }
    }

    #[test]
    fn pkce_checks_state_and_challenge_renews_and_disconnects() {
        tauri::async_runtime::block_on(async {
            let server = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let base = format!("http://{}", server.local_addr().unwrap());
            let provider = || Provider {
                authorization_url: format!("{base}/authorize"),
                token_url: format!("{base}/token"),
                client_id: "desktop-fixture".into(),
                scope: "read".into(),
            };
            let (browser, authorize) = tokio::sync::oneshot::channel::<Url>();
            let worker = tokio::spawn(async move {
                let browser = Client::new();
                let authorize = authorize.await.unwrap();
                let params: BTreeMap<_, _> = authorize.query_pairs().collect();
                assert_eq!(params["response_type"], "code");
                assert_eq!(params["code_challenge_method"], "S256");
                let mut callback = Url::parse(&params["redirect_uri"]).unwrap();
                callback
                    .query_pairs_mut()
                    .append_pair("code", "wrong")
                    .append_pair("state", "wrong");
                assert_eq!(
                    browser.get(callback.clone()).send().await.unwrap().status(),
                    400
                );
                callback
                    .query_pairs_mut()
                    .clear()
                    .append_pair("code", "fixture-code")
                    .append_pair("state", &params["state"]);
                assert_eq!(browser.get(callback).send().await.unwrap().status(), 200);

                let (mut stream, _) = server.accept().await.unwrap();
                let (path, headers, body) = read_request(&mut stream).await;
                let form: BTreeMap<_, _> = url::form_urlencoded::parse(body.as_bytes()).collect();
                assert_eq!(path, "/token");
                assert!(!headers.contains_key("authorization"));
                assert_eq!(form["grant_type"], "authorization_code");
                assert_eq!(form["client_id"], "desktop-fixture");
                assert_eq!(form["code"], "fixture-code");
                assert_eq!(form["redirect_uri"], params["redirect_uri"]);
                assert_eq!(
                    URL_SAFE_NO_PAD.encode(Sha256::digest(form["code_verifier"].as_bytes())),
                    params["code_challenge"]
                );
                reply(
                    &mut stream,
                    "200 OK",
                    json!({
                        "access_token": "fixture-expired", "refresh_token": "fixture-refresh",
                        "token_type": "Bearer", "expires_in": 0
                    }),
                )
                .await;

                let (mut stream, _) = server.accept().await.unwrap();
                let (_, _, body) = read_request(&mut stream).await;
                assert_eq!(
                    body,
                    "grant_type=refresh_token&refresh_token=fixture-refresh&client_id=desktop-fixture"
                );
                reply(
                    &mut stream,
                    "200 OK",
                    json!({
                        "access_token": "fixture-renewed", "refresh_token": "fixture-rotated",
                        "token_type": "Bearer", "expires_in": 3600
                    }),
                )
                .await;
            });
            let client = Client::new();
            let oauth = OAuth {
                vault: Some(test_vault()),
                ..Default::default()
            };
            tokio::time::timeout(
                Duration::from_secs(10),
                oauth.connect(&client, provider(), |url| {
                    browser.send(url.clone()).unwrap();
                    Ok(())
                }),
            )
            .await
            .unwrap()
            .unwrap();
            drop(oauth);

            let restarted = OAuth {
                vault: Some(test_vault()),
                ..Default::default()
            };
            let auth = || Authorization::Pkce {
                provider: provider(),
            };
            for _ in 0..2 {
                let header = tokio::time::timeout(
                    Duration::from_secs(10),
                    restarted.authorize(&client, auth(), |value| Ok(value.into())),
                )
                .await
                .unwrap()
                .unwrap();
                assert_eq!(header, "Bearer fixture-renewed");
                assert!(header.is_sensitive());
            }
            worker.await.unwrap();
            assert!(
                VAULT
                    .lock()
                    .unwrap()
                    .as_ref()
                    .unwrap()
                    .contains("fixture-rotated")
            );
            restarted.disconnect(provider()).await.unwrap();
            assert!(VAULT.lock().unwrap().is_none());
            assert_eq!(
                restarted
                    .authorize(&client, auth(), |value| Ok(value.into()))
                    .await
                    .unwrap_err(),
                RECONNECT
            );
        });
    }
}
