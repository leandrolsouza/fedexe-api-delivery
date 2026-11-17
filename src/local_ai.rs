use reqwest::{Client, Response, Url, redirect::Policy};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::{time::Duration, time::Instant};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AiError {
    InvalidEndpoint,
    ModelRequired,
    Unavailable,
    Timeout,
    ServerStatus(u16),
    InvalidResponse,
}

fn api_url(endpoint: &str, path: &str) -> Result<Url, AiError> {
    let mut url = Url::parse(endpoint.trim()).map_err(|_| AiError::InvalidEndpoint)?;
    if !matches!(url.scheme(), "http" | "https")
        || !matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(AiError::InvalidEndpoint);
    }
    let base = url.path().trim_end_matches('/');
    let base = base.strip_suffix("/chat/completions").unwrap_or(base);
    let base = if base.is_empty() { "/v1" } else { base };
    url.set_path(&format!("{base}/{path}"));
    Ok(url)
}

fn client(timeout: Duration) -> Result<Client, AiError> {
    Client::builder()
        .no_proxy()
        .redirect(Policy::none())
        .resolve("localhost", ([127, 0, 0, 1], 0).into())
        .connect_timeout(Duration::from_secs(3))
        .timeout(timeout)
        .build()
        .map_err(network_error)
}

fn network_error(error: reqwest::Error) -> AiError {
    if error.is_timeout() {
        AiError::Timeout
    } else {
        AiError::Unavailable
    }
}

async fn read_response<T: DeserializeOwned>(mut response: Response) -> Result<T, AiError> {
    if !response.status().is_success() {
        return Err(AiError::ServerStatus(response.status().as_u16()));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(network_error)? {
        if bytes.len() + chunk.len() > 1024 * 1024 {
            return Err(AiError::InvalidResponse);
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| AiError::InvalidResponse)
}

#[derive(Deserialize)]
struct Models {
    data: Vec<Model>,
}

#[derive(Deserialize)]
struct Model {
    id: String,
}

#[tauri::command]
pub(crate) async fn ai_list_models(endpoint: String) -> Result<Vec<String>, AiError> {
    let url = api_url(&endpoint, "models")?;
    let response = client(Duration::from_secs(10))?
        .get(url)
        .send()
        .await
        .map_err(network_error)?;
    let mut models: Vec<_> = read_response::<Models>(response)
        .await?
        .data
        .into_iter()
        .map(|model| model.id)
        .filter(|id| !id.trim().is_empty())
        .collect();
    models.sort_unstable();
    models.dedup();
    Ok(models)
}

#[derive(Deserialize)]
struct Completion {
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
    message: Message,
}

#[derive(Deserialize)]
struct Message {
    content: Option<String>,
}

#[tauri::command]
pub(crate) async fn ai_test_model(endpoint: String, model: String) -> Result<u64, AiError> {
    let url = api_url(&endpoint, "chat/completions")?;
    let model = model.trim();
    if model.is_empty() {
        return Err(AiError::ModelRequired);
    }
    let body = serde_json::json!({
        "model": model,
        "messages": [{ "role": "user", "content": "Reply with OK." }],
        "stream": false,
        "max_tokens": 128
    });
    let started = Instant::now();
    let response = client(Duration::from_secs(120))?
        .post(url)
        .header("Content-Type", "application/json")
        .body(body.to_string())
        .send()
        .await
        .map_err(network_error)?;
    let completion: Completion = read_response(response).await?;
    if !completion.choices.iter().any(|choice| {
        choice
            .message
            .content
            .as_deref()
            .is_some_and(|content| !content.trim().is_empty())
    }) {
        return Err(AiError::InvalidResponse);
    }
    Ok(started.elapsed().as_millis() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn discovers_models_and_tests_generation_over_loopback() {
        use std::{
            io::{BufRead, BufReader, Read, Write},
            net::TcpListener,
            thread,
        };

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://localhost:{}", listener.local_addr().unwrap().port());
        let fixture = thread::spawn(move || {
            for (request_line, response) in [
                (
                    "GET /v1/models HTTP/1.1",
                    r#"{"data":[{"id":"example"},{"id":"example"}]}"#,
                ),
                (
                    "POST /v1/chat/completions HTTP/1.1",
                    r#"{"choices":[{"message":{"content":"OK"}}]}"#,
                ),
            ] {
                let (mut socket, _) = listener.accept().unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut reader = BufReader::new(&socket);
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                assert_eq!(line.trim_end(), request_line);

                let mut length = 0;
                loop {
                    line.clear();
                    assert_ne!(reader.read_line(&mut line).unwrap(), 0);
                    if line == "\r\n" {
                        break;
                    }
                    if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                        length = value.trim().parse().unwrap();
                    }
                }
                if request_line.starts_with("POST") {
                    let mut body = vec![0; length];
                    reader.read_exact(&mut body).unwrap();
                    let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
                    assert_eq!(body["model"], "example");
                    assert_eq!(body["stream"], false);
                    assert_eq!(body["messages"][0]["content"], "Reply with OK.");
                }
                write!(
                    socket,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response}",
                    response.len()
                )
                .unwrap();
            }
        });

        assert_eq!(ai_list_models(endpoint.clone()).await.unwrap(), ["example"]);
        ai_test_model(endpoint, "example".into()).await.unwrap();
        fixture.join().unwrap();
    }

    #[test]
    fn resolves_host_base_and_full_endpoint() {
        for endpoint in [
            "http://localhost:1234",
            "http://localhost:1234/v1/",
            "http://localhost:1234/v1/chat/completions",
        ] {
            assert_eq!(
                api_url(endpoint, "models").unwrap().as_str(),
                "http://localhost:1234/v1/models"
            );
        }
        assert_eq!(
            api_url("http://[::1]:11434/api/v1", "chat/completions")
                .unwrap()
                .as_str(),
            "http://[::1]:11434/api/v1/chat/completions"
        );
    }

    #[test]
    fn rejects_remote_endpoints_and_embedded_credentials() {
        for endpoint in [
            "https://api.openai.com/v1",
            "http://192.168.1.5:1234/v1",
            "http://localhost.example.com/v1",
            "http://localhost@remote.test/v1",
            "http://user:secret@localhost/v1",
            "http://localhost/v1?key=secret",
            "http://localhost/v1#secret",
        ] {
            assert!(matches!(
                api_url(endpoint, "models"),
                Err(AiError::InvalidEndpoint)
            ));
        }
    }
}
