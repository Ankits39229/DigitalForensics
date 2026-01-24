use crate::forensic_types::{ShimcacheEntry, AuditEntry};
use winreg::enums::*;
use winreg::RegKey;
use std::collections::HashMap;

/// Shimcache (Application Compatibility Cache) analysis
/// The Shimcache tracks application execution and compatibility information
/// It's a valuable source of execution artifacts for forensic analysis

pub fn collect_shimcache_entries() -> (Vec<ShimcacheEntry>, Vec<AuditEntry>) {
    let mut shimcache_entries = Vec::new();
    let mut audit_log = Vec::new();
    
    let start_time = std::time::Instant::now();
    
    audit_log.push(AuditEntry {
        timestamp: chrono::Utc::now().to_rfc3339(),
        level: "INFO".to_string(),
        component: "shimcache".to_string(),
        action: "start_collection".to_string(),
        details: "Starting Shimcache analysis".to_string(),
        duration_ms: None,
        result: "started".to_string(),
    });
    
    // Shimcache registry locations for different Windows versions
    let shimcache_keys = vec![
        // Windows 10/11
        "SYSTEM\\CurrentControlSet\\Control\\Session Manager\\AppCompatCache",
        // Windows 7/8
        "SYSTEM\\CurrentControlSet\\Control\\Session Manager\\AppCompatibility\\AppCompatCache",
        // Alternative locations
        "SYSTEM\\ControlSet001\\Control\\Session Manager\\AppCompatCache",
        "SYSTEM\\ControlSet002\\Control\\Session Manager\\AppCompatCache",
    ];
    
    for key_path in shimcache_keys {
        match collect_shimcache_from_key(key_path) {
            Ok((entries, logs)) => {
                shimcache_entries.extend(entries);
                audit_log.extend(logs);
            }
            Err(e) => {
                audit_log.push(AuditEntry {
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    level: "WARN".to_string(),
                    component: "shimcache".to_string(),
                    action: "registry_access".to_string(),
                    details: format!("Failed to access {}: {}", key_path, e),
                    duration_ms: None,
                    result: "error".to_string(),
                });
            }
        }
    }
    
    let duration = start_time.elapsed();
    audit_log.push(AuditEntry {
        timestamp: chrono::Utc::now().to_rfc3339(),
        level: "INFO".to_string(),
        component: "shimcache".to_string(),
        action: "complete_collection".to_string(),
        details: format!("Collected {} shimcache entries", shimcache_entries.len()),
        duration_ms: Some(duration.as_millis() as u64),
        result: "success".to_string(),
    });
    
    (shimcache_entries, audit_log)
}

fn collect_shimcache_from_key(key_path: &str) -> Result<(Vec<ShimcacheEntry>, Vec<AuditEntry>), Box<dyn std::error::Error>> {
    let mut shimcache_entries = Vec::new();
    let mut audit_log = Vec::new();
    
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let shimcache_key = hklm.open_subkey(key_path)?;
    
    audit_log.push(AuditEntry {
        timestamp: chrono::Utc::now().to_rfc3339(),
        level: "DEBUG".to_string(),
        component: "shimcache".to_string(),
        action: "registry_open".to_string(),
        details: format!("Opened registry key: {}", key_path),
        duration_ms: None,
        result: "success".to_string(),
    });
    
    // Try to read the AppCompatCache value (Windows 10/11)
    if let Ok(cache_data) = shimcache_key.get_raw_value("AppCompatCache") {
        match parse_shimcache_data(&cache_data.bytes) {
            Ok(entries) => {
                shimcache_entries.extend(entries);
                audit_log.push(AuditEntry {
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    level: "DEBUG".to_string(),
                    component: "shimcache".to_string(),
                    action: "parse_cache_data".to_string(),
                    details: format!("Parsed {} entries from AppCompatCache", shimcache_entries.len()),
                    duration_ms: None,
                    result: "success".to_string(),
                });
            }
            Err(e) => {
                audit_log.push(AuditEntry {
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    level: "ERROR".to_string(),
                    component: "shimcache".to_string(),
                    action: "parse_cache_data".to_string(),
                    details: format!("Failed to parse shimcache data: {}", e),
                    duration_ms: None,
                    result: "error".to_string(),
                });
            }
        }
    }
    
    // Try to enumerate individual entries (older Windows versions)
    for value_name in shimcache_key.enum_values().map(|x| x.unwrap().0) {
        if value_name.starts_with("AppCompat") || value_name.contains("Cache") {
            if let Ok(value_data) = shimcache_key.get_raw_value(&value_name) {
                match parse_individual_shimcache_entry(&value_name, &value_data.bytes) {
                    Ok(entry) => {
                        shimcache_entries.push(entry);
                        audit_log.push(AuditEntry {
                            timestamp: chrono::Utc::now().to_rfc3339(),
                            level: "DEBUG".to_string(),
                            component: "shimcache".to_string(),
                            action: "parse_individual_entry".to_string(),
                            details: format!("Parsed entry: {}", value_name),
                            duration_ms: None,
                            result: "success".to_string(),
                        });
                    }
                    Err(e) => {
                        audit_log.push(AuditEntry {
                            timestamp: chrono::Utc::now().to_rfc3339(),
                            level: "WARN".to_string(),
                            component: "shimcache".to_string(),
                            action: "parse_individual_entry".to_string(),
                            details: format!("Failed to parse {}: {}", value_name, e),
                            duration_ms: None,
                            result: "error".to_string(),
                        });
                    }
                }
            }
        }
    }
    
    Ok((shimcache_entries, audit_log))
}

fn parse_shimcache_data(data: &[u8]) -> Result<Vec<ShimcacheEntry>, Box<dyn std::error::Error>> {
    // Conservative shimcache parser with full validation to prevent data corruption
    // Returns empty list rather than corrupted data if format is unclear
    
    if data.len() < 16 {
        eprintln!("Shimcache data too small ({}bytes), skipping parse", data.len());
        return Ok(Vec::new());
    }
    
    let header_signature = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
    let num_entries_raw = u32::from_le_bytes([data[4], data[5], data[6], data[7]]);
    
    // Validate entry count to prevent processing corrupted data
    if num_entries_raw == 0 || num_entries_raw > 10000 {
        eprintln!("Shimcache entry count suspicious: {} (skipping parse)", num_entries_raw);
        return Ok(Vec::new());
    }
    
    // Conservative approach: Only parse Windows 10+ format we're confident about
    // Shimcache format varies significantly between Windows versions and is poorly documented
    // Better to return no data than corrupted data
    let is_parseable = header_signature == 0xBADC0FFE || header_signature == 0xBADC0FEE;
    
    if !is_parseable {
        eprintln!("Shimcache format not recognized (sig:0x{:X}). Skipping to avoid corruption.", header_signature);
        return Ok(Vec::new());
    }
    
    // For now, return empty list until we can properly implement Windows version-specific parsing
    // This prevents the critical data corruption issue
    eprintln!("Shimcache parsing temporarily disabled pending format verification");
    Ok(Vec::new())
}

// DISABLED: Unsafe shimcache parser - was causing data corruption
// See SHIMCACHE_FIX_NOTES.md for details
// Will be replaced with properly validated Windows version-specific parsers
/*
fn parse_shimcache_entry(data: &[u8], signature: u32) -> Result<(ShimcacheEntry, usize), Box<dyn std::error::Error>> {
    if data.len() < 32 {
        return Err("Insufficient data for shimcache entry".into());
    }
    
    // Entry format varies by Windows version
    let (path, last_modified, file_size, last_update, execution_flag, entry_size) = match signature {
        0x30 | 0x34 | 0x38 => parse_windows10_entry(data)?, // Windows 10/11
        0x80 | 0x73 => parse_windows8_entry(data)?,  // Windows 8.1
        0x72 | 0x6f | 0x74 => parse_windows7_entry(data)?,  // Windows 7
        _ => return Err("Unsupported shimcache format".into()),
    };
    
    let entry = ShimcacheEntry {
        path,
        last_modified,
        file_size,
        last_update,
        execution_flag,
    };
    
    Ok((entry, entry_size))
}
*/

fn parse_windows10_entry(data: &[u8]) -> Result<(String, String, u64, String, bool, usize), Box<dyn std::error::Error>> {
    // Windows 10/11 shimcache entry format
    let path_length = u16::from_le_bytes([data[0], data[1]]) as usize;
    let path_offset = u16::from_le_bytes([data[2], data[3]]) as usize;
    
    let file_size = u64::from_le_bytes([
        data[8], data[9], data[10], data[11],
        data[12], data[13], data[14], data[15]
    ]);
    
    let last_modified_raw = u64::from_le_bytes([
        data[16], data[17], data[18], data[19],
        data[20], data[21], data[22], data[23]
    ]);
    
    let last_update_raw = u64::from_le_bytes([
        data[24], data[25], data[26], data[27],
        data[28], data[29], data[30], data[31]
    ]);
    
    // Extract path string (UTF-16)
    let path = if path_offset + path_length <= data.len() {
        let path_bytes = &data[path_offset..path_offset + path_length];
        parse_utf16_string(path_bytes)
    } else {
        "Unknown path".to_string()
    };
    
    let last_modified = filetime_to_string(last_modified_raw);
    let last_update = filetime_to_string(last_update_raw);
    let execution_flag = true; // Windows 10+ doesn't have explicit execution flag
    
    let entry_size = 32 + path_length;
    
    Ok((path, last_modified, file_size, last_update, execution_flag, entry_size))
}

fn parse_windows8_entry(_data: &[u8]) -> Result<(String, String, u64, String, bool, usize), Box<dyn std::error::Error>> {
    // Windows 8.1 shimcache entry format (simplified)
    let path = "Windows 8 entry (parsing not fully implemented)".to_string();
    let last_modified = chrono::Utc::now().to_rfc3339();
    let file_size = 0;
    let last_update = chrono::Utc::now().to_rfc3339();
    let execution_flag = false;
    let entry_size = 32;
    
    Ok((path, last_modified, file_size, last_update, execution_flag, entry_size))
}

fn parse_windows7_entry(_data: &[u8]) -> Result<(String, String, u64, String, bool, usize), Box<dyn std::error::Error>> {
    // Windows 7 shimcache entry format (simplified)
    let path = "Windows 7 entry (parsing not fully implemented)".to_string();
    let last_modified = chrono::Utc::now().to_rfc3339();
    let file_size = 0;
    let last_update = chrono::Utc::now().to_rfc3339();
    let execution_flag = false;
    let entry_size = 32;
    
    Ok((path, last_modified, file_size, last_update, execution_flag, entry_size))
}

fn parse_individual_shimcache_entry(value_name: &str, data: &[u8]) -> Result<ShimcacheEntry, Box<dyn std::error::Error>> {
    // Parse individual registry value as shimcache entry
    Ok(ShimcacheEntry {
        path: format!("Registry entry: {}", value_name),
        last_modified: chrono::Utc::now().to_rfc3339(),
        file_size: data.len() as u64,
        last_update: chrono::Utc::now().to_rfc3339(),
        execution_flag: false,
    })
}

fn parse_utf16_string(data: &[u8]) -> String {
    // Convert UTF-16 bytes to string
    let utf16_data: Vec<u16> = data
        .chunks_exact(2)
        .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
        .take_while(|&c| c != 0) // Stop at null terminator
        .collect();
    
    String::from_utf16(&utf16_data).unwrap_or_else(|_| "Invalid UTF-16".to_string())
}

fn filetime_to_string(filetime: u64) -> String {
    // Convert Windows FILETIME to readable string
    if filetime == 0 {
        return "Not set".to_string();
    }
    
    // FILETIME is 100-nanosecond intervals since January 1, 1601
    const FILETIME_EPOCH_DIFF: u64 = 11644473600; // Seconds between 1601 and 1970
    const FILETIME_UNITS_PER_SEC: u64 = 10_000_000;
    
    let unix_timestamp = (filetime / FILETIME_UNITS_PER_SEC).saturating_sub(FILETIME_EPOCH_DIFF);
    
    match chrono::DateTime::from_timestamp(unix_timestamp as i64, 0) {
        Some(dt) => dt.to_rfc3339(),
        None => "Invalid timestamp".to_string(),
    }
}

/// Get shimcache statistics for reporting
pub fn get_shimcache_statistics(shimcache_entries: &[ShimcacheEntry]) -> HashMap<String, u32> {
    let mut stats = HashMap::new();
    
    stats.insert("total_entries".to_string(), shimcache_entries.len() as u32);
    
    let executed_count = shimcache_entries.iter()
        .filter(|entry| entry.execution_flag)
        .count();
    stats.insert("executed_programs".to_string(), executed_count as u32);
    
    let not_executed_count = shimcache_entries.len() - executed_count;
    stats.insert("not_executed_programs".to_string(), not_executed_count as u32);
    
    // Count by file extensions
    let mut exe_count = 0;
    let mut dll_count = 0;
    let mut sys_count = 0;
    let mut other_count = 0;
    
    for entry in shimcache_entries {
        let path_lower = entry.path.to_lowercase();
        if path_lower.ends_with(".exe") {
            exe_count += 1;
        } else if path_lower.ends_with(".dll") {
            dll_count += 1;
        } else if path_lower.ends_with(".sys") {
            sys_count += 1;
        } else {
            other_count += 1;
        }
    }
    
    stats.insert("exe_files".to_string(), exe_count);
    stats.insert("dll_files".to_string(), dll_count);
    stats.insert("sys_files".to_string(), sys_count);
    stats.insert("other_files".to_string(), other_count);
    
    stats
}

/// Find shimcache entries for a specific executable
pub fn find_shimcache_by_path<'a>(shimcache_entries: &'a [ShimcacheEntry], search_path: &str) -> Vec<&'a ShimcacheEntry> {
    shimcache_entries.iter()
        .filter(|entry| entry.path.to_lowercase().contains(&search_path.to_lowercase()))
        .collect()
}

/// Get recently modified shimcache entries
pub fn get_recently_modified_entries<'a>(shimcache_entries: &'a [ShimcacheEntry], limit: usize) -> Vec<&'a ShimcacheEntry> {
    let mut entries: Vec<_> = shimcache_entries.iter().collect();
    
    entries.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    entries.truncate(limit);
    entries
}

/// Get executed programs from shimcache
pub fn get_executed_programs<'a>(shimcache_entries: &'a [ShimcacheEntry]) -> Vec<&'a ShimcacheEntry> {
    shimcache_entries.iter()
        .filter(|entry| entry.execution_flag)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn test_collect_shimcache_entries() {
        // Test shimcache collection - should handle registry access gracefully
        let (shimcache_entries, audit_log) = collect_shimcache_entries();
        
        // Should have audit log entries
        assert!(!audit_log.is_empty());
        
        // Should have start and complete entries
        let has_start = audit_log.iter().any(|log| log.action == "start_collection");
        let has_complete = audit_log.iter().any(|log| log.action == "complete_collection");
        assert!(has_start);
        assert!(has_complete);
    }

    #[test]
    fn test_shimcache_statistics() {
        let mut shimcache_entries = Vec::new();
        
        // Create test shimcache entries
        shimcache_entries.push(ShimcacheEntry {
            path: "C:\\Windows\\System32\\notepad.exe".to_string(),
            last_modified: "2023-01-01T00:00:00Z".to_string(),
            file_size: 1024,
            last_update: "2023-01-01T00:00:00Z".to_string(),
            execution_flag: true,
        });
        
        shimcache_entries.push(ShimcacheEntry {
            path: "C:\\Windows\\System32\\calc.exe".to_string(),
            last_modified: "2023-01-02T00:00:00Z".to_string(),
            file_size: 2048,
            last_update: "2023-01-02T00:00:00Z".to_string(),
            execution_flag: false,
        });
        
        shimcache_entries.push(ShimcacheEntry {
            path: "C:\\Windows\\System32\\kernel32.dll".to_string(),
            last_modified: "2023-01-03T00:00:00Z".to_string(),
            file_size: 4096,
            last_update: "2023-01-03T00:00:00Z".to_string(),
            execution_flag: false,
        });
        
        let stats = get_shimcache_statistics(&shimcache_entries);
        
        assert_eq!(stats.get("total_entries"), Some(&3));
        assert_eq!(stats.get("executed_programs"), Some(&1));
        assert_eq!(stats.get("not_executed_programs"), Some(&2));
        assert_eq!(stats.get("exe_files"), Some(&2));
        assert_eq!(stats.get("dll_files"), Some(&1));
    }

    #[test]
    fn test_find_shimcache_by_path() {
        let mut shimcache_entries = Vec::new();
        
        shimcache_entries.push(ShimcacheEntry {
            path: "C:\\Windows\\System32\\notepad.exe".to_string(),
            last_modified: "2023-01-01T00:00:00Z".to_string(),
            file_size: 1024,
            last_update: "2023-01-01T00:00:00Z".to_string(),
            execution_flag: true,
        });
        
        shimcache_entries.push(ShimcacheEntry {
            path: "C:\\Program Files\\MyApp\\app.exe".to_string(),
            last_modified: "2023-01-02T00:00:00Z".to_string(),
            file_size: 2048,
            last_update: "2023-01-02T00:00:00Z".to_string(),
            execution_flag: false,
        });
        
        let results = find_shimcache_by_path(&shimcache_entries, "notepad");
        assert_eq!(results.len(), 1);
        assert!(results[0].path.contains("notepad.exe"));
        
        let results = find_shimcache_by_path(&shimcache_entries, "nonexistent");
        assert_eq!(results.len(), 0);
    }

    #[test]
    fn test_get_executed_programs() {
        let mut shimcache_entries = Vec::new();
        
        shimcache_entries.push(ShimcacheEntry {
            path: "C:\\Windows\\System32\\notepad.exe".to_string(),
            last_modified: "2023-01-01T00:00:00Z".to_string(),
            file_size: 1024,
            last_update: "2023-01-01T00:00:00Z".to_string(),
            execution_flag: true,
        });
        
        shimcache_entries.push(ShimcacheEntry {
            path: "C:\\Windows\\System32\\calc.exe".to_string(),
            last_modified: "2023-01-02T00:00:00Z".to_string(),
            file_size: 2048,
            last_update: "2023-01-02T00:00:00Z".to_string(),
            execution_flag: false,
        });
        
        let executed = get_executed_programs(&shimcache_entries);
        assert_eq!(executed.len(), 1);
        assert_eq!(executed[0].path, "C:\\Windows\\System32\\notepad.exe");
    }

    #[test]
    fn test_parse_utf16_string() {
        // Test with simple ASCII string in UTF-16 format
        let utf16_data = vec![
            b'H', 0, b'e', 0, b'l', 0, b'l', 0, b'o', 0, 0, 0 // "Hello" + null terminator
        ];
        
        let result = parse_utf16_string(&utf16_data);
        assert_eq!(result, "Hello");
        
        // Test with empty data
        let empty_data = vec![0, 0];
        let result = parse_utf16_string(&empty_data);
        assert_eq!(result, "");
    }

    #[test]
    fn test_filetime_to_string() {
        // Test with zero filetime
        let result = filetime_to_string(0);
        assert_eq!(result, "Not set");
        
        // Test with a known filetime value (approximate)
        // This is a rough test since exact conversion depends on system
        let filetime = 132000000000000000u64; // Approximate value
        let result = filetime_to_string(filetime);
        assert!(result.contains("T")); // Should be ISO format
        assert!(result.len() > 10); // Should be a reasonable timestamp
    }

    #[test]
    fn test_get_recently_modified_entries() {
        let mut shimcache_entries = Vec::new();
        
        shimcache_entries.push(ShimcacheEntry {
            path: "C:\\old.exe".to_string(),
            last_modified: "2023-01-01T00:00:00Z".to_string(),
            file_size: 1024,
            last_update: "2023-01-01T00:00:00Z".to_string(),
            execution_flag: false,
        });
        
        shimcache_entries.push(ShimcacheEntry {
            path: "C:\\new.exe".to_string(),
            last_modified: "2023-12-31T23:59:59Z".to_string(),
            file_size: 2048,
            last_update: "2023-12-31T23:59:59Z".to_string(),
            execution_flag: false,
        });
        
        let recent = get_recently_modified_entries(&shimcache_entries, 1);
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].path, "C:\\new.exe");
    }
}