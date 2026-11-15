use std::{io, ptr};
use windows_sys::Win32::{
    Foundation::ERROR_NOT_FOUND,
    Security::Credentials::{
        CRED_MAX_CREDENTIAL_BLOB_SIZE, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC, CREDENTIALW,
        CredDeleteW, CredFree, CredReadW, CredWriteW,
    },
};

fn credential_target(environment: &str, variable: &str) -> Result<Vec<u16>, String> {
    if environment.contains('\0') || variable.contains('\0') {
        return Err("Identificador de segredo inválido.".into());
    }
    // Hex encoding prevents case-insensitive Windows targets from aliasing imported IDs.
    let id = serde_json::to_vec(&(environment, variable)).map_err(|e| e.to_string())?;
    let encoded: String = id.iter().map(|byte| format!("{byte:02x}")).collect();
    Ok(format!("app.fedexe.api/{encoded}")
        .encode_utf16()
        .chain([0])
        .collect())
}

#[tauri::command]
pub fn read_secret(environment: String, variable: String) -> Result<Option<String>, String> {
    read_target(credential_target(&environment, &variable)?)
}

pub(crate) fn read_target(target: Vec<u16>) -> Result<Option<String>, String> {
    let mut credential = ptr::null_mut();
    // Windows owns the returned allocation until CredFree.
    if unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) } == 0 {
        return missing_or_error(None);
    }
    let result = unsafe {
        let entry = &*credential;
        let bytes = if entry.CredentialBlobSize == 0 {
            &[]
        } else {
            std::slice::from_raw_parts(entry.CredentialBlob, entry.CredentialBlobSize as usize)
        };
        let value = String::from_utf8(bytes.to_vec());
        CredFree(credential.cast());
        value
    };
    result
        .map(Some)
        .map_err(|_| "O cofre contém um segredo que não pôde ser lido.".into())
}

#[tauri::command]
pub fn write_secret(
    environment: String,
    variable: String,
    value: Option<String>,
) -> Result<(), String> {
    write_target(credential_target(&environment, &variable)?, value)
}

pub(crate) fn write_target(mut target: Vec<u16>, value: Option<String>) -> Result<(), String> {
    let Some(value) = value else {
        if unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) } != 0 {
            return Ok(());
        }
        return missing_or_error(());
    };
    let mut bytes = value.into_bytes();
    if bytes.len() > CRED_MAX_CREDENTIAL_BLOB_SIZE as usize {
        return Err("O segredo excede o limite do cofre do Windows.".into());
    }
    let credential = CREDENTIALW {
        Type: CRED_TYPE_GENERIC,
        TargetName: target.as_mut_ptr(),
        CredentialBlobSize: bytes.len() as u32,
        CredentialBlob: bytes.as_mut_ptr(),
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        ..Default::default()
    };
    // Both buffers remain valid for the duration of the call.
    if unsafe { CredWriteW(&credential, 0) } == 0 {
        return Err(io::Error::last_os_error().to_string());
    }
    Ok(())
}

fn missing_or_error<T>(missing: T) -> Result<T, String> {
    let error = io::Error::last_os_error();
    if error.raw_os_error() == Some(ERROR_NOT_FOUND as i32) {
        Ok(missing)
    } else {
        Err(error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stores_updates_and_removes_a_secret_for_one_environment() {
        let sandbox = tempfile::tempdir().unwrap();
        let environment = format!(
            "test-{}",
            sandbox.path().file_name().unwrap().to_string_lossy()
        );
        let variable = "token".to_string();
        let result = (|| {
            write_secret(environment.clone(), variable.clone(), Some("ação🔑".into()))?;
            let original = read_secret(environment.clone(), variable.clone())?;
            let other = read_secret(format!("{environment}-other"), variable.clone())?;
            write_secret(environment.clone(), variable.clone(), Some("novo".into()))?;
            let updated = read_secret(environment.clone(), variable.clone())?;
            Ok::<_, String>((original, other, updated))
        })();
        write_secret(environment.clone(), variable.clone(), None).unwrap();
        assert_eq!(
            result.unwrap(),
            (Some("ação🔑".into()), None, Some("novo".into()))
        );
        assert_eq!(read_secret(environment, variable).unwrap(), None);
    }
}
