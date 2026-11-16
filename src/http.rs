use reqwest::{Client, Method, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::BTreeMap, time::Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub mod console;
#[cfg(windows)]
pub mod drive;
pub mod oauth;

const PREVIEW_LIMIT: usize = 256 * 1024;
const VALIDATION_LIMIT: usize = 16 * 1024 * 1024;

#[derive(Clone, Deserialize)]
pub struct Request {
    method: String,
    url: String,
    #[serde(default)]
    headers: RequestHeaders,
    body: Option<String>,
    #[serde(default)]
    query: Vec<(String, String)>,
    #[serde(default)]
    path_params: Vec<(String, String)>,
    form: Option<Vec<(String, String)>>,
    multipart: Option<Vec<MultipartPart>>,
    binary_file: Option<std::path::PathBuf>,
    basic_auth: Option<(String, String)>,
    oauth: Option<oauth::Authorization>,
    #[serde(default)]
    validate_json: bool,
    timeout_ms: Option<u64>,
    #[serde(default)]
    redirect_policy: RedirectPolicy,
    #[serde(default)]
    console_masks: console::Masks,
}

#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "snake_case")]
enum RedirectPolicy {
    #[default]
    None,
    SameOrigin,
}

pub struct Clients {
    direct: Client,
    oauth: oauth::OAuth,
    same_origin: Client,
}

impl Clients {
    pub fn new() -> Result<Self, reqwest::Error> {
        Ok(Self {
            oauth: oauth::OAuth::default(),
            direct: Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
            same_origin: Client::builder()
                .referer(false)
                .redirect(same_origin_redirects())
                .build()?,
        })
    }

    pub fn with_oauth_vault(mut self, vault: oauth::Vault) -> Self {
        self.oauth.vault = Some(vault);
        self
    }

    pub async fn connect_oauth(
        &self,
        provider: oauth::Provider,
        open_browser: impl FnOnce(&Url) -> Result<(), String>,
    ) -> Result<(), String> {
        self.oauth
            .connect(&self.direct, provider, open_browser)
            .await
    }

    pub async fn disconnect_oauth(&self, provider: oauth::Provider) -> Result<(), String> {
        self.oauth.disconnect(provider).await
    }

    fn for_request(&self, request: &Request) -> &Client {
        match request.redirect_policy {
            RedirectPolicy::None => &self.direct,
            RedirectPolicy::SameOrigin => &self.same_origin,
        }
    }
}

fn same_origin_redirects() -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(|attempt| {
        let target = attempt.url();
        if !target.username().is_empty()
            || target.password().is_some()
            || !attempt
                .previous()
                .first()
                .is_some_and(|original| original.origin() == target.origin())
        {
            return attempt.stop();
        }
        if attempt.previous().len() > 10 {
            console::redirect(attempt.status(), target, false);
            return attempt.error("Limite de 10 redirecionamentos excedido.");
        }
        console::redirect(attempt.status(), target, true);
        attempt.follow()
    })
}

#[derive(Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum MultipartPart {
    Field {
        name: String,
        value: String,
    },
    File {
        name: String,
        path: std::path::PathBuf,
    },
}

async fn file_body(path: &std::path::Path) -> Result<(reqwest::Body, u64), String> {
    if !path.is_absolute()
        || !tokio::fs::metadata(path)
            .await
            .is_ok_and(|info| info.is_file())
    {
        return Err("Arquivo do corpo indisponível. Selecione o arquivo novamente.".into());
    }
    let file = tokio::fs::File::open(path)
        .await
        .map_err(|_| "Não foi possível abrir o arquivo do corpo.")?;
    let info = file
        .metadata()
        .await
        .map_err(|_| "Não foi possível ler os dados do arquivo.")?;
    if !info.is_file() {
        return Err("Selecione um arquivo regular para o corpo.".into());
    }
    Ok((
        reqwest::Body::wrap_stream(tokio_util::io::ReaderStream::new(file.take(info.len()))),
        info.len(),
    ))
}

#[derive(Clone, Deserialize)]
#[serde(untagged)]
enum RequestHeaders {
    Entries(Vec<(String, String)>),
    Legacy(BTreeMap<String, String>),
}

impl Default for RequestHeaders {
    fn default() -> Self {
        Self::Entries(Vec::new())
    }
}

#[derive(Serialize)]
pub struct Response {
    status: u16,
    duration_ms: u128,
    headers: Vec<(String, String)>,
    preview: String,
    truncated: bool,
    size_bytes: u64,
    pub body_id: Option<String>,
    #[serde(skip)]
    pub body_file: Option<std::fs::File>,
}

#[derive(Deserialize)]
pub struct Collection {
    #[serde(default)]
    variables: BTreeMap<String, String>,
    requests: Vec<Step>,
    #[serde(default)]
    stop_on_failure: bool,
    iterations: Option<usize>,
    #[serde(default)]
    delay_ms: u64,
}

#[derive(Clone, Deserialize)]
struct Step {
    name: String,
    request: Option<Request>,
    preparation_error: Option<String>,
    #[serde(default)]
    tests: Vec<Test>,
    #[serde(default)]
    extract: BTreeMap<String, String>,
}

#[derive(Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Test {
    Status {
        equals: u16,
    },
    Header {
        name: String,
        equals: Option<String>,
    },
    Json {
        pointer: String,
        equals: Value,
    },
}

#[derive(Serialize)]
pub struct ResultRow {
    name: String,
    status: Option<u16>,
    http_ms: u128,
    validation_ms: u128,
    checks_passed: usize,
    failures: Vec<String>,
    failure_reasons: Vec<FailureReason>,
    #[serde(skip)]
    execution_error: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum FailureReason {
    Status,
    Header,
    Json,
    Extraction,
    Preparation,
    Transport,
}

impl ResultRow {
    fn add_failure(&mut self, reason: FailureReason, message: String) {
        self.failure_reasons.push(reason);
        self.failures.push(message);
    }
}

#[derive(Serialize)]
pub struct Run {
    duration_ms: u128,
    results: Vec<ResultRow>,
    outcome: RunOutcome,
}

#[cfg(feature = "cli")]
impl Run {
    pub fn cli_report(&self) -> (u8, Value) {
        let mut exit_code = 0;
        let steps: Vec<_> = self
            .results
            .iter()
            .enumerate()
            .map(|(index, row)| {
                let (code, result) = if row.execution_error {
                    (2, "execution_error")
                } else if !row.failures.is_empty() {
                    (1, "validation_failed")
                } else {
                    (0, "passed")
                };
                exit_code = exit_code.max(code);
                serde_json::json!({
                    "step": index + 1,
                    "result": result,
                    "status": row.status,
                    "http_ms": row.http_ms,
                    "validation_ms": row.validation_ms,
                    "checks_passed": row.checks_passed,
                    "failures": row.failures.len(),
                })
            })
            .collect();
        (
            exit_code,
            serde_json::json!({
                "schema_version": 1,
                "exit_code": exit_code,
                "outcome": self.outcome,
                "duration_ms": self.duration_ms,
                "steps": steps,
            }),
        )
    }
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum RunOutcome {
    Completed,
    Cancelled,
    StoppedOnFailure,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RunProgress<'a> {
    Started { index: usize },
    Finished { index: usize, row: &'a ResultRow },
}

fn http_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        return "A requisição excedeu o timeout configurado.".into();
    }
    use std::error::Error;
    let error = error.without_url();
    let mut message = error.to_string();
    let mut cause = error.source();
    while let Some(error) = cause {
        message.push_str(": ");
        message.push_str(&error.to_string());
        cause = error.source();
    }
    message
}

fn expand(input: &str, variables: &BTreeMap<String, String>) -> Result<String, String> {
    expand_value(input, variables).inspect_err(|_| console::resolution_error())
}

fn expand_value(input: &str, variables: &BTreeMap<String, String>) -> Result<String, String> {
    let mut output = String::new();
    let mut rest = input;
    while let Some((literal, variable)) = rest.split_once("{{") {
        let (name, tail) = variable
            .split_once("}}")
            .ok_or("Variável sem fechamento.")?;
        output.push_str(literal);
        output.push_str(
            variables
                .get(name.trim())
                .ok_or_else(|| format!("Variável ausente: {name}"))?,
        );
        rest = tail;
    }
    output.push_str(rest);
    Ok(output)
}

async fn perform(
    clients: &Clients,
    request: Request,
    variables: &BTreeMap<String, String>,
) -> Result<reqwest::Response, String> {
    let client = clients.for_request(&request);
    let request = prepare_request(clients, request, variables).await?;
    execute_request(client, request).await
}

async fn prepare_request(
    clients: &Clients,
    mut request: Request,
    variables: &BTreeMap<String, String>,
) -> Result<reqwest::Request, String> {
    if console::active() {
        for template in std::mem::take(&mut request.console_masks.templates) {
            if let Ok(value) = expand_value(&template, variables) {
                request.console_masks.values.push(value);
            }
        }
        console::masks(std::mem::take(&mut request.console_masks));
    }
    let client = clients.for_request(&request);
    let method = Method::from_bytes(request.method.as_bytes()).map_err(|e| e.to_string())?;
    let mut url = Url::parse(&resolve_path(&request.url, request.path_params, variables)?)
        .map_err(|e| e.to_string())?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Use uma URL HTTP(S) e informe credenciais nos headers.".into());
    }
    if !request.query.is_empty() {
        let mut query = url.query_pairs_mut();
        for (key, value) in request.query {
            query.append_pair(&expand(&key, variables)?, &expand(&value, variables)?);
        }
    }
    let timeout = request.timeout_ms.unwrap_or(30_000);
    if !(1..=600_000).contains(&timeout) {
        return Err("O timeout deve ficar entre 1 e 600.000 ms.".into());
    }
    let mut builder = client
        .request(method, url)
        .timeout(std::time::Duration::from_millis(timeout));
    let headers = match request.headers {
        RequestHeaders::Entries(entries) => entries,
        RequestHeaders::Legacy(entries) => entries.into_iter().collect(),
    };
    if (request.multipart.is_some() || request.binary_file.is_some())
        && headers.iter().any(|(name, _)| {
            name.eq_ignore_ascii_case("content-length")
                || name.eq_ignore_ascii_case("transfer-encoding")
        })
    {
        return Err("Remova Content-Length e Transfer-Encoding manuais deste corpo.".into());
    }
    if request.multipart.is_some()
        && headers
            .iter()
            .any(|(name, _)| name.eq_ignore_ascii_case("content-type"))
    {
        return Err("Remova o Content-Type manual para gerar o boundary multipart.".into());
    }
    for (name, value) in headers {
        let name = reqwest::header::HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| "Nome de header inválido.")?;
        let value = reqwest::header::HeaderValue::from_str(&expand(&value, variables)?)
            .map_err(|_| format!("Valor inválido para o header {name}."))?;
        builder = builder.header(name, value);
    }
    if let Some((username, password)) = request.basic_auth {
        let username = expand(&username, variables)?;
        let password = expand(&password, variables)?;
        console::secret(&username);
        console::secret(&password);
        builder = builder.basic_auth(username, Some(password));
    }
    if let Some(parts) = request.multipart {
        console::request_format("multipart/form-data");
        let mut form = reqwest::multipart::Form::new();
        for part in parts {
            match part {
                MultipartPart::Field { name, value } => {
                    let name = part_name(&name, variables)?;
                    let value = expand(&value, variables)?;
                    console::multipart_field(&name, &value);
                    form = form.text(name, value);
                }
                MultipartPart::File { name, path } => {
                    console::multipart_file();
                    let filename = path
                        .file_name()
                        .ok_or("Arquivo multipart sem nome.")?
                        .to_string_lossy()
                        .into_owned();
                    let (body, size) = file_body(&path).await?;
                    let part = reqwest::multipart::Part::stream_with_length(body, size)
                        .file_name(filename)
                        .mime_str("application/octet-stream")
                        .map_err(http_error)?;
                    form = form.part(part_name(&name, variables)?, part);
                }
            }
        }
        builder = builder.multipart(form);
    } else if let Some(path) = request.binary_file {
        let (body, size) = file_body(&path).await?;
        builder = builder
            .header(reqwest::header::CONTENT_LENGTH, size)
            .body(body);
    } else if let Some(form) = request.form {
        console::request_format("application/x-www-form-urlencoded");
        let mut encoded = url::form_urlencoded::Serializer::new(String::new());
        for (key, value) in form {
            encoded.append_pair(&expand(&key, variables)?, &expand(&value, variables)?);
        }
        builder = builder.body(encoded.finish());
    } else if let Some(body) = request.body {
        let body = expand(&body, variables)?;
        if request.validate_json {
            console::request_format("application/json");
            serde_json::from_str::<Value>(&body).map_err(|e| format!("JSON inválido: {e}"))?;
        }
        builder = builder.body(body);
    }
    let mut prepared = builder.build().map_err(http_error)?;
    if let Some(auth) = request.oauth {
        if prepared
            .headers()
            .contains_key(reqwest::header::AUTHORIZATION)
        {
            return Err("OAuth 2.0 exige que o header Authorization seja gerado pelo app.".into());
        }
        oauth::validate_resource(prepared.url())?;
        let token = clients
            .oauth
            .authorize(&clients.direct, auth, |value| expand(value, variables))
            .await?;
        prepared
            .headers_mut()
            .insert(reqwest::header::AUTHORIZATION, token);
    }
    Ok(prepared)
}

async fn execute_request(
    client: &Client,
    request: reqwest::Request,
) -> Result<reqwest::Response, String> {
    console::request(&request);
    let response = client.execute(request).await.map_err(|error| {
        console::transport_error(&error);
        http_error(error)
    })?;
    console::response(&response);
    Ok(response)
}

fn part_name(name: &str, variables: &BTreeMap<String, String>) -> Result<String, String> {
    let name = expand(name, variables)?;
    if name.trim().is_empty() {
        return Err("Informe o nome de cada parte multipart ativa.".into());
    }
    Ok(name)
}

fn resolve_path(
    url: &str,
    rows: Vec<(String, String)>,
    variables: &BTreeMap<String, String>,
) -> Result<String, String> {
    let authority = url.find("://").map_or(0, |index| index + 3);
    let Some(start) = url[authority..]
        .find(['/', '?', '#'])
        .map(|n| n + authority)
    else {
        return expand(url, variables);
    };
    if !url[start..].starts_with('/') {
        return expand(url, variables);
    }
    let end = url[start..]
        .find(['?', '#'])
        .map_or(url.len(), |n| n + start);
    let path = &url[start..end];
    static PLACEHOLDER: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r"\{\{(?s:.*?)\}\}|\{([A-Za-z0-9_-]+)\}").unwrap()
    });
    let params: BTreeMap<_, _> = rows.into_iter().collect();
    let mut resolved = url[..start].to_owned();
    let mut cursor = 0;
    for capture in PLACEHOLDER.captures_iter(path) {
        let placeholder = capture.get(0).unwrap();
        resolved.push_str(&path[cursor..placeholder.start()]);
        if let Some(key) = capture.get(1) {
            let key = key.as_str();
            let template = params.get(key).ok_or_else(|| {
                console::resolution_error();
                format!("Parâmetro de caminho ausente: {key}.")
            })?;
            let value = expand(template, variables)?;
            if matches!(value.as_str(), "" | "." | "..") {
                console::resolution_error();
                return Err(format!(
                    "Valor inválido para o parâmetro de caminho: {key}."
                ));
            }
            use std::fmt::Write;
            for byte in value.bytes() {
                if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) {
                    resolved.push(char::from(byte));
                } else {
                    write!(resolved, "%{byte:02X}").unwrap();
                }
            }
        } else {
            resolved.push_str(placeholder.as_str());
        }
        cursor = placeholder.end();
    }
    resolved.push_str(&path[cursor..]);
    resolved.push_str(&url[end..]);
    expand(&resolved, variables)
}

async fn read_limited(
    response: &mut reqwest::Response,
    limit: usize,
) -> Result<(Vec<u8>, bool), String> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| http_error(e))? {
        console::chunk(&chunk);
        let remaining = limit - bytes.len();
        bytes.extend_from_slice(&chunk[..remaining.min(chunk.len())]);
        if chunk.len() > remaining {
            return Ok((bytes, true));
        }
    }
    Ok((bytes, false))
}

pub async fn send(clients: &Clients, request: Request) -> Result<Response, String> {
    let start = Instant::now();
    let mut response = perform(clients, request, &BTreeMap::new()).await?;
    let mut file = tokio::fs::File::from_std(tempfile::tempfile().map_err(|e| e.to_string())?);
    let mut preview = Vec::new();
    let mut size_bytes = 0;
    while let Some(chunk) = response.chunk().await.map_err(http_error)? {
        console::chunk(&chunk);
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        let remaining = PREVIEW_LIMIT - preview.len();
        preview.extend_from_slice(&chunk[..remaining.min(chunk.len())]);
        size_bytes += chunk.len() as u64;
    }
    file.flush().await.map_err(|e| e.to_string())?;
    Ok(Response {
        status: response.status().as_u16(),
        duration_ms: start.elapsed().as_millis(),
        headers: response
            .headers()
            .iter()
            .map(|(name, value)| {
                (
                    name.to_string(),
                    String::from_utf8_lossy(value.as_bytes()).into_owned(),
                )
            })
            .collect(),
        preview: String::from_utf8_lossy(&preview).into_owned(),
        truncated: size_bytes > preview.len() as u64,
        size_bytes,
        body_id: None,
        body_file: Some(file.into_std().await),
    })
}

pub async fn send_runner_step(
    clients: &Clients,
    request: Request,
    variables: BTreeMap<String, String>,
    capture_body: bool,
) -> Result<Response, String> {
    let start = Instant::now();
    let mut response = perform(clients, request, &variables).await?;
    let (preview, truncated) = if capture_body {
        read_limited(&mut response, VALIDATION_LIMIT).await?
    } else {
        while let Some(chunk) = response.chunk().await.map_err(http_error)? {
            console::chunk(&chunk);
        }
        (Vec::new(), false)
    };
    Ok(Response {
        status: response.status().as_u16(),
        duration_ms: start.elapsed().as_millis(),
        headers: response
            .headers()
            .iter()
            .map(|(name, value)| {
                (
                    name.to_string(),
                    String::from_utf8_lossy(value.as_bytes()).into_owned(),
                )
            })
            .collect(),
        size_bytes: preview.len() as u64,
        preview: String::from_utf8_lossy(&preview).into_owned(),
        truncated,
        body_id: None,
        body_file: None,
    })
}

pub fn mask_runner_response(response: &Response, extract: &BTreeMap<String, String>) {
    if response.truncated {
        console::hide_response_details();
        return;
    }
    let Ok(json) = serde_json::from_str::<Value>(&response.preview) else {
        if !response.preview.is_empty() {
            console::hide_response_details();
        }
        return;
    };
    for pointer in extract.values().filter(|pointer| valid_pointer(pointer)) {
        match json.pointer(pointer) {
            Some(Value::String(value)) => console::secret(value),
            Some(value) if value.is_number() || value.is_boolean() => {
                console::secret(&value.to_string());
            }
            _ => {}
        }
    }
}

pub fn save_body(source: &mut std::fs::File, path: &std::path::Path) -> std::io::Result<()> {
    use std::io::{Seek, SeekFrom};
    let directory = path.parent().ok_or(std::io::ErrorKind::InvalidInput)?;
    let mut target = tempfile::NamedTempFile::new_in(directory)?;
    source.seek(SeekFrom::Start(0))?;
    std::io::copy(source, &mut target)?;
    target.as_file().sync_all()?;
    target.persist(path)?;
    Ok(())
}

async fn run_step(
    clients: &Clients,
    step: Step,
    variables: &mut BTreeMap<String, String>,
    row: &mut ResultRow,
) -> Result<(), (FailureReason, String)> {
    use FailureReason::{Extraction, Header, Json, Preparation, Status, Transport};
    let start = Instant::now();
    let request = step.request.ok_or_else(|| {
        (
            Preparation,
            step.preparation_error
                .unwrap_or_else(|| "Requisição ausente.".into()),
        )
    })?;
    let client = clients.for_request(&request);
    let request = prepare_request(clients, request, variables)
        .await
        .map_err(|error| (Preparation, error))?;
    let mut response = execute_request(client, request)
        .await
        .map_err(|error| (Transport, error))?;
    let status = response.status().as_u16();
    row.status = Some(status);
    let needs_json = !step.extract.is_empty()
        || step
            .tests
            .iter()
            .any(|test| matches!(test, Test::Json { .. }));
    let body = if needs_json {
        Some(
            read_limited(&mut response, VALIDATION_LIMIT)
                .await
                .map_err(|error| (Transport, error))?,
        )
    } else {
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| (Transport, http_error(error)))?
        {
            console::chunk(&chunk);
        }
        None
    };
    row.http_ms = start.elapsed().as_millis();

    let start = Instant::now();
    let json = body
        .as_ref()
        .map(|(bytes, truncated)| {
            if *truncated {
                Err("Corpo acima do limite de validação de 16 MiB.".to_string())
            } else {
                serde_json::from_slice::<Value>(bytes).map_err(|e| format!("JSON inválido: {e}"))
            }
        })
        .transpose();

    for test in step.tests {
        let failure = match test {
            Test::Status { equals } if status != equals => Some((
                Status,
                format!("Status esperado {equals}, recebido {status}."),
            )),
            Test::Header { name, equals } => {
                let name = name.trim();
                if !response.headers().contains_key(name) {
                    Some((Header, format!("Header ausente: {name}")))
                } else if equals.is_some_and(|expected| {
                    !response
                        .headers()
                        .get_all(name)
                        .iter()
                        .any(|value| value.as_bytes() == expected.as_bytes())
                }) {
                    Some((Header, format!("Valor inesperado no header {name}.")))
                } else {
                    None
                }
            }
            Test::Json { pointer, .. } if !valid_pointer(&pointer) => {
                Some((Json, format!("JSON Pointer inválido: {pointer}.")))
            }
            Test::Json { pointer, equals } => match &json {
                Ok(Some(value)) if value.pointer(&pointer) == Some(&equals) => None,
                Ok(_) => Some((Json, format!("Valor inesperado em {pointer}."))),
                Err(error) => Some((Json, error.clone())),
            },
            _ => None,
        };
        if let Some((reason, failure)) = failure {
            row.add_failure(reason, failure);
        } else {
            row.checks_passed += 1;
        }
    }

    for (name, pointer) in step.extract {
        if !valid_pointer(&pointer) {
            row.add_failure(Extraction, format!("JSON Pointer inválido: {pointer}."));
            continue;
        }
        match &json {
            Ok(Some(value)) => match value.pointer(&pointer) {
                Some(Value::String(value)) => {
                    console::extracted(&name, value);
                    variables.insert(name, value.clone());
                }
                Some(value) if value.is_number() || value.is_boolean() => {
                    let value = value.to_string();
                    console::extracted(&name, &value);
                    variables.insert(name, value);
                }
                _ => row.add_failure(
                    Extraction,
                    format!("Extração exige um valor escalar em {pointer}."),
                ),
            },
            Err(error) => row.add_failure(Extraction, error.clone()),
            Ok(None) => unreachable!("Extraction requires JSON"),
        }
    }
    row.validation_ms = start.elapsed().as_millis();
    Ok(())
}

fn valid_pointer(pointer: &str) -> bool {
    pointer.is_empty()
        || (pointer.starts_with('/')
            && pointer
                .match_indices('~')
                .all(|(index, _)| matches!(pointer.as_bytes().get(index + 1), Some(b'0' | b'1'))))
}

pub async fn run(
    clients: &Clients,
    collection: Collection,
    mut cancel: tokio::sync::oneshot::Receiver<()>,
    report: impl Fn(RunProgress<'_>),
) -> Result<Run, String> {
    if collection.requests.is_empty() {
        return Err("Adicione pelo menos uma requisição.".into());
    }
    let iterations = collection.iterations.unwrap_or(1);
    if !(1..=100).contains(&iterations) || collection.delay_ms > 60_000 {
        return Err("Use de 1 a 100 iterações e um intervalo de 0 a 60000 ms.".into());
    }
    let start = Instant::now();
    let request_count = collection.requests.len();
    let mut results = Vec::with_capacity(request_count);
    let mut outcome = RunOutcome::Completed;
    let mut variables = collection.variables.clone();
    for (index, step) in collection
        .requests
        .iter()
        .cycle()
        .take(request_count * iterations)
        .enumerate()
    {
        if cancel.try_recv().is_ok() {
            outcome = RunOutcome::Cancelled;
            break;
        }
        if index > 0 && collection.delay_ms > 0 {
            tokio::select! {
                biased;
                _ = &mut cancel => {
                    outcome = RunOutcome::Cancelled;
                    break;
                }
                _ = tokio::time::sleep(std::time::Duration::from_millis(collection.delay_ms)) => {}
            }
        }
        if index > 0 && index % request_count == 0 {
            variables.clone_from(&collection.variables);
        }
        report(RunProgress::Started { index });
        let mut row = ResultRow {
            name: step.name.clone(),
            status: None,
            http_ms: 0,
            validation_ms: 0,
            checks_passed: 0,
            failures: Vec::new(),
            failure_reasons: Vec::new(),
            execution_error: false,
        };
        let step_start = Instant::now();
        console::start(Some(index + 1));
        let validation = tokio::select! {
            biased;
            signal = &mut cancel => {
                debug_assert!(signal.is_ok(), "active execution must retain its sender");
                outcome = RunOutcome::Cancelled;
                console::finish(Some("Execução cancelada."), false);
                break;
            }
            result = run_step(clients, step.clone(), &mut variables, &mut row) => result,
        };
        console::finish(
            validation
                .as_ref()
                .err()
                .map(|(_, message)| message.as_str()),
            !row.failures.is_empty(),
        );
        if let Err((reason, error)) = validation {
            row.execution_error = true;
            row.http_ms = step_start.elapsed().as_millis();
            row.add_failure(reason, error);
        }
        report(RunProgress::Finished { index, row: &row });
        let stop = collection.stop_on_failure && !row.failures.is_empty();
        results.push(row);
        if stop {
            outcome = RunOutcome::StoppedOnFailure;
            break;
        }
    }
    Ok(Run {
        duration_ms: start.elapsed().as_millis(),
        results,
        outcome,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::{
        io::{BufRead, BufReader, Write},
        net::TcpListener,
        thread,
        time::Duration,
    };

    fn test_clients() -> Clients {
        Clients {
            oauth: oauth::OAuth::default(),
            direct: Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .unwrap(),
            same_origin: Client::builder()
                .no_proxy()
                .redirect(same_origin_redirects())
                .build()
                .unwrap(),
        }
    }

    #[test]
    fn diagnoses_network_errors_missing_variables_and_large_responses_in_one_run() {
        let server = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", server.local_addr().unwrap());
        let worker = thread::spawn(move || {
            let oversized = format!("{{\"padding\":\"{}\"}}", "x".repeat(VALIDATION_LIMIT));
            for path in ["/disconnect", "/large", "/large", "/ok"] {
                let (mut stream, _) = server.accept().unwrap();
                let mut reader = BufReader::new(&mut stream);
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                assert_eq!(line.split_whitespace().nth(1), Some(path));
                loop {
                    line.clear();
                    if reader.read_line(&mut line).unwrap() == 0 || line == "\r\n" {
                        break;
                    }
                }
                if path == "/disconnect" {
                    continue;
                }
                let body = if path == "/large" {
                    oversized.as_str()
                } else {
                    "{}"
                };
                let _ = write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
            }
        });
        tauri::async_runtime::block_on(async {
            let clients = test_clients();
            let requests: Vec<_> = [
                ("Rede", format!("{base}/disconnect"), false),
                ("Variável", "{{missing}}/ok".into(), false),
                ("Status", format!("{base}/large"), false),
                ("JSON", format!("{base}/large"), true),
                ("Final", format!("{base}/ok"), false),
            ]
            .into_iter()
            .map(|(name, url, validate)| {
                let mut tests = vec![json!({"type":"status","equals":200})];
                if validate {
                    tests.push(json!({"type":"json","pointer":"/padding","equals":"x"}));
                }
                json!({"name":name,"request":{"method":"GET","url":url},"tests":tests})
            })
            .collect();
            let collection = serde_json::from_value(json!({ "requests": requests })).unwrap();
            let (_cancel, receiver) = tokio::sync::oneshot::channel();
            let result = run(&clients, collection, receiver, |_| {}).await.unwrap();
            assert_eq!(result.outcome, RunOutcome::Completed);
            let [network, variable, status, json, final_row] = result.results.as_slice() else {
                panic!("Esperava cinco etapas");
            };
            assert!(network.status.is_none() && !network.failures.is_empty());
            assert_eq!(network.failure_reasons, [FailureReason::Transport]);
            assert!(variable.failures[0].contains("Variável ausente: missing"));
            assert_eq!(variable.failure_reasons, [FailureReason::Preparation]);
            assert_eq!(status.checks_passed, 1);
            assert!(status.failures.is_empty());
            assert_eq!(json.checks_passed, 1);
            assert!(json.failures[0].contains("limite de validação de 16 MiB"));
            assert_eq!(json.failure_reasons, [FailureReason::Json]);
            assert!(final_row.failures.is_empty());
        });
        worker.join().unwrap();
    }

    #[test]
    fn retains_completed_rows_on_cancel_and_obeys_failure_policy() {
        tauri::async_runtime::block_on(async {
            let clients = test_clients();
            for (stop_on_failure, cancel_second, expected, count) in [
                (false, false, RunOutcome::Completed, 2),
                (true, false, RunOutcome::StoppedOnFailure, 1),
                (false, true, RunOutcome::Cancelled, 1),
            ] {
                let collection = serde_json::from_value(json!({
                    "stop_on_failure": stop_on_failure,
                    "requests": [
                        { "name": "First", "request": {"method": "GET", "url": "{{missing}}"} },
                        { "name": "Second", "preparation_error": "Header em conflito." }
                    ]
                }))
                .unwrap();
                let (sender, receiver) = tokio::sync::oneshot::channel();
                let sender = std::cell::RefCell::new(Some(sender));
                let result = run(&clients, collection, receiver, |event| {
                    if cancel_second && matches!(event, RunProgress::Started { index: 1 }) {
                        sender.borrow_mut().take().unwrap().send(()).unwrap();
                    }
                })
                .await
                .unwrap();
                assert_eq!(result.outcome, expected);
                assert_eq!(result.results.len(), count);
                assert_eq!(result.results[0].name, "First");
                assert!(result.results[0].failures[0].contains("Variável ausente"));
                if count == 2 {
                    assert_eq!(result.results[1].failures, ["Header em conflito."]);
                }
            }
        });
    }

    #[test]
    fn cancels_during_the_delay_between_iterations() {
        tauri::async_runtime::block_on(async {
            let clients = test_clients();
            let collection = serde_json::from_value(json!({
                "iterations": 2,
                "delay_ms": 60_000,
                "requests": [{ "name": "First", "preparation_error": "fixture" }]
            }))
            .unwrap();
            let (sender, receiver) = tokio::sync::oneshot::channel();
            let sender = std::cell::RefCell::new(Some(sender));
            let result = tokio::time::timeout(
                Duration::from_secs(2),
                run(&clients, collection, receiver, |event| {
                    if matches!(event, RunProgress::Finished { index: 0, .. }) {
                        let sender = sender.borrow_mut().take().unwrap();
                        tokio::spawn(async move {
                            tokio::time::sleep(Duration::from_millis(10)).await;
                            let _ = sender.send(());
                        });
                    }
                }),
            )
            .await
            .unwrap()
            .unwrap();
            assert_eq!(result.outcome, RunOutcome::Cancelled);
            assert_eq!(result.results.len(), 1);
        });
    }

    #[test]
    fn applies_redirect_policy_and_timeout_per_endpoint() {
        let source = TcpListener::bind("127.0.0.1:0").unwrap();
        let external = TcpListener::bind("127.0.0.1:0").unwrap();
        external.set_nonblocking(true).unwrap();
        let target = external.local_addr().unwrap();
        let base = format!("http://{}", source.local_addr().unwrap());
        let server = thread::spawn(move || {
            for expected in ["/local", "/local", "/end", "/foreign", "/slow"] {
                let (mut socket, _) = source.accept().unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut reader = BufReader::new(&mut socket);
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                assert_eq!(line.split_whitespace().nth(1), Some(expected));
                let mut authenticated = false;
                loop {
                    line.clear();
                    if reader.read_line(&mut line).unwrap() == 0 || line == "\r\n" {
                        break;
                    }
                    authenticated |= line
                        .trim()
                        .eq_ignore_ascii_case("authorization: Bearer fixture");
                }
                assert!(authenticated);
                let response = match expected {
                    "/local" => "302 Found\r\nLocation: /end\r\n".to_owned(),
                    "/foreign" => format!("302 Found\r\nLocation: http://{target}/collect\r\n"),
                    "/slow" => {
                        thread::sleep(Duration::from_millis(250));
                        "200 OK\r\n".into()
                    }
                    _ => "200 OK\r\n".into(),
                };
                let _ = write!(
                    socket,
                    "HTTP/1.1 {response}Content-Length: 0\r\nConnection: close\r\n\r\n"
                );
            }
            assert_eq!(
                external.accept().unwrap_err().kind(),
                std::io::ErrorKind::WouldBlock
            );
        });
        tauri::async_runtime::block_on(async {
            let clients = test_clients();
            for (path, policy, timeout, expected) in [
                ("/local", "none", 2000, Ok(302)),
                ("/local", "same_origin", 2000, Ok(200)),
                ("/foreign", "same_origin", 2000, Ok(302)),
                (
                    "/slow",
                    "none",
                    100,
                    Err("A requisição excedeu o timeout configurado."),
                ),
            ] {
                let request = serde_json::from_value(json!({
                    "method": "GET", "url": format!("{base}{path}"),
                    "headers": [["Authorization", "Bearer fixture"]],
                    "redirect_policy": policy, "timeout_ms": timeout,
                }))
                .unwrap();
                let response = send(&clients, request)
                    .await
                    .map(|response| response.status);
                assert_eq!(response, expected.map_err(str::to_owned));
            }
        });
        server.join().unwrap();
    }

    #[test]
    fn console_records_editor_and_runner_requests_without_exposing_credentials() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server = thread::spawn(move || {
            let long_preview = "x".repeat(8 * 1024 - "runner".len()) + "runner-secret";
            for expected in [
                "/redirect?passcode=a%26b",
                "/done?token=redirect-secret",
                "/login",
                "/use/runner-secret",
                "/slow",
                "/extract",
            ] {
                let (mut socket, _) = listener.accept().unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut reader = BufReader::new(&mut socket);
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                assert_eq!(line.split_whitespace().nth(1), Some(expected));
                let mut headers = String::new();
                loop {
                    line.clear();
                    if reader.read_line(&mut line).unwrap() == 0 || line == "\r\n" {
                        break;
                    }
                    headers.push_str(&line);
                }
                if let Some(length) = headers
                    .lines()
                    .find_map(|line| line.strip_prefix("content-length: "))
                {
                    use std::io::Read;
                    let mut body = vec![0; length.parse().unwrap()];
                    reader.read_exact(&mut body).unwrap();
                }
                let (status, extra, body) = match expected {
                    "/redirect?passcode=a%26b" => {
                        assert!(headers.contains("x-private: editor-secret"));
                        ("302 Found", "Location: /done?token=redirect-secret\r\n", "")
                    }
                    "/done?token=redirect-secret" => (
                        "200 OK",
                        "Set-Cookie: sid=cookie-secret\r\n",
                        r#"{"ok":true,"reflected":["a&b","editor-secret","redirect-secret","cookie-secret"],"access_token":"response-secret","copy":"response-secret"}"#,
                    ),
                    "/login" => ("200 OK", "", r#"{"ticket":"runner-secret"}"#),
                    "/use/runner-secret" => {
                        assert!(headers.contains("x-observation: runner-secret"));
                        ("200 OK", "", long_preview.as_str())
                    }
                    "/extract" => (
                        "200 OK",
                        "X-Observation: extracted-secret\r\n",
                        r#"{"ticket":"extracted-secret","ok":true}"#,
                    ),
                    _ => {
                        thread::sleep(Duration::from_millis(250));
                        ("200 OK", "", "")
                    }
                };
                let _ = write!(
                    socket,
                    "HTTP/1.1 {status}\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
            }
        });
        let entries = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        tauri::async_runtime::block_on(async {
            let clients = test_clients();
            let recorded = entries.clone();
            console::observe(move |entry| recorded.lock().unwrap().push(entry), async {
                console::start(None);
                let request = serde_json::from_value(json!({
                    "method": "POST",
                    "url": format!("{base}/redirect?passcode=a%26b"),
                    "body": r#"{"message":"hello","password":"body-secret","copy":"body-secret","header":"editor-secret"}"#,
                    "validate_json": true,
                    "headers": [["X-Private", "editor-secret"]],
                    "console_masks": {"values": [], "templates": [], "headers": ["x-private"], "query": ["passcode"]},
                    "redirect_policy": "same_origin"
                })).unwrap();
                let response = send(&clients, request).await.unwrap();
                assert_eq!(response.status, 200);
                assert!(response.preview.contains("editor-secret"));
                console::finish(None, false);
            }).await;
            let recorded = entries.clone();
            let collection = serde_json::from_value(json!({
                "requests": [
                    {"name": "login", "request": {"method": "GET", "url": format!("{base}/login")}, "extract": {"ticket": "/ticket"}},
                    {"name": "use", "request": {"method": "POST", "url": format!("{base}/use/{{{{ticket}}}}"), "headers": [["X-Observation", "{{ticket}}"]], "form": [["message", "hello world"], ["ticket", "{{ticket}}"], ["api_key", "form-secret"]]}},
                    {"name": "slow", "request": {"method": "GET", "url": format!("{base}/slow"), "timeout_ms": 100}},
                    {"name": "missing", "request": {"method": "GET", "url": format!("{base}/{{{{missing}}}}")}}
                ]
            })).unwrap();
            let (_sender, receiver) = tokio::sync::oneshot::channel();
            console::observe(
                move |entry| recorded.lock().unwrap().push(entry),
                run(&clients, collection, receiver, |_| {}),
            )
            .await
            .unwrap();
            let recorded = entries.clone();
            console::observe(move |entry| recorded.lock().unwrap().push(entry), async {
                console::start(Some(1));
                let request = serde_json::from_value(json!({
                    "method": "GET",
                    "url": format!("{base}/extract"),
                }))
                .unwrap();
                let response = send_runner_step(&clients, request, BTreeMap::new(), true)
                    .await
                    .unwrap();
                mask_runner_response(
                    &response,
                    &BTreeMap::from([("ticket".to_owned(), "/ticket".to_owned())]),
                );
                console::finish(None, false);
            })
            .await;
        });
        server.join().unwrap();
        let entries = serde_json::to_value(&*entries.lock().unwrap()).unwrap();
        let text = entries.to_string();
        for secret in [
            "a&b",
            "a%26b",
            "editor-secret",
            "body-secret",
            "form-secret",
            "redirect-secret",
            "cookie-secret",
            "response-secret",
            "runner-secret",
            "extracted-secret",
        ] {
            assert!(!text.contains(secret), "{text}");
        }
        assert_eq!(entries.as_array().unwrap().len(), 6);
        let extracted = &entries[5]["response"];
        assert_eq!(extracted["truncated"], false);
        let preview: Value = serde_json::from_str(extracted["preview"].as_str().unwrap()).unwrap();
        assert_eq!(preview, json!({"ticket": "[***]", "ok": true}));
        assert!(
            extracted["headers"]
                .as_array()
                .unwrap()
                .contains(&json!(["x-observation", "[***]"]))
        );
        assert_eq!(entries[0]["request"]["method"], "POST");
        let body = &entries[0]["request"]["body"];
        let preview: Value = serde_json::from_str(body["preview"].as_str().unwrap()).unwrap();
        assert_eq!(body["truncated"], false);
        assert_eq!(preview["message"], "hello");
        assert_eq!(preview["password"], "[***]");
        assert_eq!(preview["copy"], "[***]");
        assert_eq!(preview["header"], "[***]");
        assert_eq!(entries[0]["response"]["status"], 200);
        assert!(
            entries[0]["response"]["preview"]
                .as_str()
                .unwrap()
                .contains("\"ok\": true")
        );
        assert_eq!(entries[0]["redirects"][0]["status"], 302);
        assert_eq!(entries[0]["redirects"][0]["followed"], true);
        let form = entries[2]["request"]["body"]["preview"].as_str().unwrap();
        assert!(form.contains("message=hello+world"));
        assert!(form.contains("ticket=[***]"));
        assert!(form.contains("api_key=%5B***%5D"));
        assert_eq!(entries[2]["response"]["status"], 200);
        assert_eq!(entries[2]["response"]["truncated"], true);
        let preview = entries[2]["response"]["preview"].as_str().unwrap();
        assert!(preview.ends_with("[***]"));
        assert!(preview.len() <= 8 * 1024);
        assert_eq!(entries[3]["failure"], "timeout");
        assert_eq!(entries[4]["failure"], "resolution");
        assert_eq!(entries[4]["step"], 4);
    }

    #[test]
    fn resolves_structured_query_form_and_basic_auth_before_sending() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let server = thread::spawn(move || {
            use std::io::Read;
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(&mut stream);
            let mut headers = String::new();
            let mut length = 0;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" || line.is_empty() {
                    break;
                }
                if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length: ") {
                    length = value.trim().parse().unwrap();
                }
                headers.push_str(&line);
            }
            let mut body = vec![0; length];
            reader.read_exact(&mut body).unwrap();
            assert!(headers.starts_with(
                "POST /users/Jo%C3%A3o%20%2F%3F%23?search=a%26b+%2F+c&tag=1&tag=2 HTTP/1.1"
            ));
            assert!(
                headers
                    .to_ascii_lowercase()
                    .contains("authorization: basic dxnlcjpwyxnz")
            );
            assert_eq!(
                headers
                    .lines()
                    .filter(|line| line.starts_with("x-repeat:"))
                    .collect::<Vec<_>>(),
                ["x-repeat: first", "x-repeat: second"]
            );
            assert_eq!(String::from_utf8(body).unwrap(), "name=Jo%C3%A3o+Silva");
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}"
            )
            .unwrap();
        });
        tauri::async_runtime::block_on(async {
            let clients = test_clients();
            let request = serde_json::from_value(json!({
                "method": "POST", "url": format!("{base_url}/users/{{id}}#ignored"),
                "path_params": [["id", "João /?#"]],
                "headers": [["Content-Type", "application/x-www-form-urlencoded"], ["X-Repeat", "first"], ["x-repeat", "second"]],
                "body": null,
                "query": [["search", "a&b / c"], ["tag", "1"], ["tag", "2"]],
                "form": [["name", "João Silva"]],
                "basic_auth": ["user", "pass"]
            }))
            .unwrap();
            assert_eq!(send(&clients, request).await.unwrap().status, 200);
        });
        server.join().unwrap();
    }

    #[test]
    fn streams_binary_and_multipart_bodies() {
        use std::io::Read;
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("fixture.bin");
        let payload = vec![0xff, 0x00, 0x80, b'\n'].repeat(256 * 1024);
        std::fs::write(&path, &payload).unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = thread::spawn(move || {
            for multipart in [false, true] {
                let (mut stream, _) = listener.accept().unwrap();
                let mut reader = BufReader::new(&mut stream);
                let mut length = 0;
                let mut boundary = None;
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    if line == "\r\n" || line.is_empty() {
                        break;
                    }
                    if let Some(value) = line.strip_prefix("content-length: ") {
                        length = value.trim().parse().unwrap();
                    }
                    if let Some(value) =
                        line.strip_prefix("content-type: multipart/form-data; boundary=")
                    {
                        boundary = Some(value.trim().to_owned());
                    }
                }
                let mut body = vec![0; length];
                reader.read_exact(&mut body).unwrap();
                if multipart {
                    let boundary = boundary.unwrap();
                    assert!(body.starts_with(format!("--{boundary}\r\n").as_bytes()));
                    assert!(body.ends_with(format!("--{boundary}--\r\n").as_bytes()));
                    assert!(body.windows(payload.len()).any(|bytes| bytes == payload));
                    let description = String::from_utf8_lossy(&body[..1024]);
                    assert!(description.contains("name=\"label\"\r\n\r\nOlá"));
                    assert!(description.contains("name=\"upload\"; filename=\"fixture.bin\""));
                } else {
                    assert_eq!(body, payload);
                }
                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                )
                .unwrap();
            }
        });
        tauri::async_runtime::block_on(async {
            let clients = test_clients();
            let binary = serde_json::from_value(json!({
                "method": "POST", "url": url, "binary_file": path,
            }))
            .unwrap();
            assert_eq!(send(&clients, binary).await.unwrap().status, 200);
            let multipart = serde_json::from_value(json!({
                "method": "POST", "url": url,
                "multipart": [
                    { "kind": "field", "name": "label", "value": "{{message}}" },
                    { "kind": "file", "name": "upload", "path": path },
                ],
            }))
            .unwrap();
            assert_eq!(
                perform(
                    &clients,
                    multipart,
                    &BTreeMap::from([("message".into(), "Olá".into())])
                )
                .await
                .unwrap()
                .status(),
                200
            );
        });
        server.join().unwrap();
    }

    #[test]
    fn rejects_invalid_json_before_connecting() {
        tauri::async_runtime::block_on(async {
            let clients = test_clients();
            let request = serde_json::from_value(json!({
                "method": "POST", "url": "http://127.0.0.1:9/users", "body": "{invalid}", "validate_json": true
            })).unwrap();
            assert!(
                send(&clients, request)
                    .await
                    .err()
                    .unwrap()
                    .contains("JSON inválido")
            );
        });
    }

    #[test]
    fn runs_one_hundred_requests_with_extraction_and_limits_large_preview() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let large_body = format!(
            r#"{{"ok":true,"padding":"{}"}}"#,
            "x".repeat(10 * 1024 * 1024)
        );
        let large = large_body.clone();
        thread::spawn(move || {
            for _ in 0..102 {
                let (mut stream, _) = listener.accept().unwrap();
                let mut reader = BufReader::new(&mut stream);
                let mut headers = String::new();
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap() == 0 || line == "\r\n" {
                        break;
                    }
                    headers.push_str(&line.to_ascii_lowercase());
                }
                let (status, body) = if headers.starts_with("get /token ") {
                    ("200 OK", r#"{"session/keys":{"~tokens":["local-test"]}}"#)
                } else if headers.starts_with("get /large ")
                    && headers.contains("authorization: bearer local-test")
                    || headers.starts_with("get /preview ")
                {
                    ("200 OK", large.as_str())
                } else if headers.contains("authorization: bearer local-test") {
                    ("200 OK", r#"{"ok":true}"#)
                } else {
                    ("401 Unauthorized", "{}")
                };
                let _ = write!(
                    stream,
                    "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nX-Check: first\r\nX-Check: second\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
            }
        });

        tauri::async_runtime::block_on(async {
            let clients = test_clients();
            let mut requests = vec![json!({
                "name": "token",
                "request": { "method": "GET", "url": "{{base_url}}/token" },
                "tests": [
                    { "type": "header", "name": "X-Check" },
                    { "type": "header", "name": "x-CHECK", "equals": "second" },
                    { "type": "header", "name": "x-check", "equals": "Second" },
                    { "type": "header", "name": "x-missing" }
                ],
                "extract": { "token": "/session~1keys/~0tokens/0" }
            })];
            for index in 1..100 {
                let path = if index <= 3 { "large" } else { "private" };
                let tests = if index <= 3 {
                    json!([{ "type": "json", "pointer": "/ok", "equals": true }])
                } else {
                    json!([{ "type": "status", "equals": 200 }])
                };
                requests.push(json!({
                    "name": format!("request {index}"),
                    "request": {
                        "method": "GET", "url": format!("{{{{base_url}}}}/{path}"),
                        "headers": { "Authorization": "Bearer {{token}}" }
                    },
                    "tests": tests
                }));
            }
            let collection = serde_json::from_value(json!({
                "variables": { "base_url": base_url },
                "requests": requests
            }))
            .unwrap();
            let events = std::cell::RefCell::new(Vec::new());
            let (_cancel, receiver) = tokio::sync::oneshot::channel();
            let result = run(&clients, collection, receiver, |progress| {
                events.borrow_mut().push(match progress {
                    RunProgress::Started { index } => (index, false),
                    RunProgress::Finished { index, row } => {
                        assert!(row.status.is_some());
                        (index, true)
                    }
                });
            })
            .await
            .unwrap();
            assert_eq!(
                events.into_inner(),
                (0..100)
                    .flat_map(|index| [(index, false), (index, true)])
                    .collect::<Vec<_>>()
            );
            assert_eq!(result.results.len(), 100);
            assert_eq!(result.results[0].checks_passed, 2);
            assert_eq!(
                result.results[0].failures,
                [
                    "Valor inesperado no header x-check.",
                    "Header ausente: x-missing"
                ]
            );
            for row in &result.results[1..] {
                assert!(row.failures.is_empty(), "{}: {:?}", row.name, row.failures);
            }
            assert_eq!(result.results[1].checks_passed, 1);

            let request = serde_json::from_value(json!({
                "method": "GET",
                "url": format!("{base_url}/preview")
            }))
            .unwrap();
            let scripted_request = serde_json::from_value(json!({
                "method": "GET",
                "url": "{{base_url}}/large",
                "headers": { "Authorization": "Bearer {{token}}" }
            }))
            .unwrap();
            let scripted = send_runner_step(
                &clients,
                scripted_request,
                BTreeMap::from([
                    ("base_url".into(), base_url.clone()),
                    ("token".into(), "local-test".into()),
                ]),
                true,
            )
            .await
            .unwrap();
            assert_eq!(scripted.status, 200);
            assert_eq!(scripted.preview, large_body);
            assert!(!scripted.truncated);
            assert!(scripted.body_file.is_none());

            let mut response = send(&clients, request).await.unwrap();
            assert_eq!(response.preview.len(), PREVIEW_LIMIT);
            assert!(response.truncated);
            assert_eq!(response.size_bytes, large_body.len() as u64);
            let directory = tempfile::tempdir().unwrap();
            let destination = directory.path().join("resposta.bin");
            std::fs::write(&destination, b"arquivo anterior").unwrap();
            let source = response.body_file.as_mut().unwrap();
            save_body(source, &destination).unwrap();
            let exported = std::fs::read(&destination).unwrap();
            assert_eq!(exported, large_body.as_bytes());
            assert_eq!(&exported[..PREVIEW_LIMIT], response.preview.as_bytes());
            let second = directory.path().join("outra-resposta.bin");
            save_body(source, &second).unwrap();
            assert_eq!(std::fs::read(second).unwrap(), exported);
        });
    }
}
