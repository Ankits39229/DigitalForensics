use chrono::{DateTime, Utc, Duration};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileActivity {
    pub timestamp: String,
    pub action: String,
    pub file_path: String,
    pub previous_path: Option<String>,
    pub file_size: Option<u64>,
    pub file_extension: Option<String>,
    pub source: String, // "USN Journal", "Recent Files", "Downloads", "Recycle Bin"
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileActivityReport {
    pub collection_time: String,
    pub time_range_hours: u64,
    pub total_activities: usize,
    pub activities_by_type: HashMap<String, usize>,
    pub activities: Vec<FileActivity>,
}

impl FileActivityReport {
    pub fn new(time_range_hours: u64) -> Self {
        Self {
            collection_time: Utc::now().to_rfc3339(),
            time_range_hours,
            total_activities: 0,
            activities_by_type: HashMap::new(),
            activities: Vec::new(),
        }
    }

    pub fn add_activity(&mut self, activity: FileActivity) {
        *self.activities_by_type.entry(activity.action.clone()).or_insert(0) += 1;
        self.activities.push(activity);
        self.total_activities += 1;
    }

    pub fn sort_by_timestamp(&mut self) {
        self.activities.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    }
}

/// Collect file activity from the last N hours
pub fn collect_file_activity(hours: u64) -> Result<FileActivityReport, String> {
    let mut report = FileActivityReport::new(hours);
    let cutoff_time = Utc::now() - Duration::hours(hours as i64);

    // Collect from multiple sources
    collect_recent_files(&mut report, &cutoff_time);
    collect_downloads(&mut report, &cutoff_time);
    collect_recycle_bin(&mut report, &cutoff_time);
    collect_user_documents(&mut report, &cutoff_time);
    collect_temp_files(&mut report, &cutoff_time);

    report.sort_by_timestamp();
    Ok(report)
}

/// Collect recently accessed files from Windows Recent Items
fn collect_recent_files(report: &mut FileActivityReport, cutoff_time: &DateTime<Utc>) {
    let user_profile = std::env::var("USERPROFILE").unwrap_or_default();
    let recent_path = Path::new(&user_profile).join("AppData\\Roaming\\Microsoft\\Windows\\Recent");

    if let Ok(entries) = fs::read_dir(&recent_path) {
        for entry in entries.flatten() {
            if let Ok(metadata) = entry.metadata() {
                if let Ok(modified) = metadata.modified() {
                    let modified_time: DateTime<Utc> = modified.into();
                    if modified_time > *cutoff_time {
                        let file_path = entry.path().display().to_string();
                        
                        // Try to resolve LNK target
                        let target_path = if file_path.ends_with(".lnk") {
                            resolve_lnk_target(&entry.path()).unwrap_or(file_path.clone())
                        } else {
                            file_path.clone()
                        };

                        report.add_activity(FileActivity {
                            timestamp: modified_time.to_rfc3339(),
                            action: "Accessed".to_string(),
                            file_path: target_path,
                            previous_path: None,
                            file_size: Some(metadata.len()),
                            file_extension: entry.path().extension().and_then(|s| s.to_str()).map(String::from),
                            source: "Recent Files".to_string(),
                        });
                    }
                }
            }
        }
    }
}

/// Collect recently downloaded files
fn collect_downloads(report: &mut FileActivityReport, cutoff_time: &DateTime<Utc>) {
    let user_profile = std::env::var("USERPROFILE").unwrap_or_default();
    let downloads_paths = vec![
        Path::new(&user_profile).join("Downloads"),
        Path::new(&user_profile).join("Desktop"),
    ];

    for downloads_path in downloads_paths {
        if let Ok(entries) = fs::read_dir(&downloads_path) {
            for entry in entries.flatten() {
                if let Ok(metadata) = entry.metadata() {
                    if metadata.is_file() {
                        if let Ok(created) = metadata.created() {
                            let created_time: DateTime<Utc> = created.into();
                            if created_time > *cutoff_time {
                                report.add_activity(FileActivity {
                                    timestamp: created_time.to_rfc3339(),
                                    action: "Created/Downloaded".to_string(),
                                    file_path: entry.path().display().to_string(),
                                    previous_path: None,
                                    file_size: Some(metadata.len()),
                                    file_extension: entry.path().extension().and_then(|s| s.to_str()).map(String::from),
                                    source: "Downloads".to_string(),
                                });
                            }
                        }
                    }
                }
            }
        }
    }
}

/// Collect deleted files from Recycle Bin
fn collect_recycle_bin(report: &mut FileActivityReport, cutoff_time: &DateTime<Utc>) {
    // Get all drives
    let drives = get_fixed_drives();
    
    for drive in drives {
        let recycle_bin_path = Path::new(&drive).join("$Recycle.Bin");
        
        if let Ok(entries) = fs::read_dir(&recycle_bin_path) {
            for sid_dir in entries.flatten() {
                if let Ok(sid_entries) = fs::read_dir(sid_dir.path()) {
                    for entry in sid_entries.flatten() {
                        let path = entry.path();
                        let filename = path.file_name().unwrap_or_default().to_string_lossy();
                        
                        // $I files contain metadata, $R files contain actual data
                        if filename.starts_with("$I") {
                            if let Ok(metadata) = entry.metadata() {
                                if let Ok(modified) = metadata.modified() {
                                    let modified_time: DateTime<Utc> = modified.into();
                                    if modified_time > *cutoff_time {
                                        // Parse $I file to get original path
                                        let original_path = parse_recycle_bin_metadata(&path)
                                            .unwrap_or_else(|| "Unknown".to_string());
                                        
                                        report.add_activity(FileActivity {
                                            timestamp: modified_time.to_rfc3339(),
                                            action: "Deleted".to_string(),
                                            file_path: original_path.clone(),
                                            previous_path: Some(path.display().to_string()),
                                            file_size: Some(metadata.len()),
                                            file_extension: Path::new(&original_path).extension()
                                                .and_then(|s| s.to_str()).map(String::from),
                                            source: "Recycle Bin".to_string(),
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/// Collect recently modified files from user documents
fn collect_user_documents(report: &mut FileActivityReport, cutoff_time: &DateTime<Utc>) {
    let user_profile = std::env::var("USERPROFILE").unwrap_or_default();
    let document_paths = vec![
        Path::new(&user_profile).join("Documents"),
        Path::new(&user_profile).join("Desktop"),
        Path::new(&user_profile).join("Pictures"),
    ];

    for doc_path in document_paths {
        scan_directory_recursive(&doc_path, report, cutoff_time, "User Documents", 2);
    }
}

/// Collect recently created/modified temp files
fn collect_temp_files(report: &mut FileActivityReport, cutoff_time: &DateTime<Utc>) {
    let temp_paths = vec![
        std::env::var("TEMP").unwrap_or_default(),
        std::env::var("TMP").unwrap_or_default(),
    ];

    for temp_path in temp_paths {
        if !temp_path.is_empty() {
            scan_directory_recursive(Path::new(&temp_path), report, cutoff_time, "Temp Files", 1);
        }
    }
}

/// Recursively scan directory for recent file activity
fn scan_directory_recursive(
    path: &Path,
    report: &mut FileActivityReport,
    cutoff_time: &DateTime<Utc>,
    source: &str,
    max_depth: u32,
) {
    scan_directory_recursive_impl(path, report, cutoff_time, source, max_depth, 0);
}

fn scan_directory_recursive_impl(
    path: &Path,
    report: &mut FileActivityReport,
    cutoff_time: &DateTime<Utc>,
    source: &str,
    max_depth: u32,
    current_depth: u32,
) {
    if current_depth > max_depth {
        return;
    }

    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            if let Ok(metadata) = entry.metadata() {
                let path = entry.path();
                
                // Check creation time
                if let Ok(created) = metadata.created() {
                    let created_time: DateTime<Utc> = created.into();
                    if created_time > *cutoff_time && metadata.is_file() {
                        report.add_activity(FileActivity {
                            timestamp: created_time.to_rfc3339(),
                            action: "Created".to_string(),
                            file_path: path.display().to_string(),
                            previous_path: None,
                            file_size: Some(metadata.len()),
                            file_extension: path.extension().and_then(|s| s.to_str()).map(String::from),
                            source: source.to_string(),
                        });
                    }
                }
                
                // Check modification time
                if let Ok(modified) = metadata.modified() {
                    let modified_time: DateTime<Utc> = modified.into();
                    if modified_time > *cutoff_time && metadata.is_file() {
                        // Only add if not already added as created
                        if let Ok(created) = metadata.created() {
                            let created_time: DateTime<Utc> = created.into();
                            if modified_time > created_time + Duration::seconds(5) {
                                report.add_activity(FileActivity {
                                    timestamp: modified_time.to_rfc3339(),
                                    action: "Modified".to_string(),
                                    file_path: path.display().to_string(),
                                    previous_path: None,
                                    file_size: Some(metadata.len()),
                                    file_extension: path.extension().and_then(|s| s.to_str()).map(String::from),
                                    source: source.to_string(),
                                });
                            }
                        }
                    }
                }

                // Recurse into subdirectories
                if metadata.is_dir() {
                    scan_directory_recursive_impl(&path, report, cutoff_time, source, max_depth, current_depth + 1);
                }
            }
        }
    }
}

/// Get list of fixed drives
fn get_fixed_drives() -> Vec<String> {
    let mut drives = Vec::new();
    
    // On Windows, check common drive letters
    for letter in b'C'..=b'Z' {
        let drive = format!("{}:\\", letter as char);
        if Path::new(&drive).exists() {
            drives.push(drive);
        }
    }
    
    drives
}

/// Parse Recycle Bin $I metadata file to get original path
fn parse_recycle_bin_metadata(path: &Path) -> Option<String> {
    if let Ok(contents) = fs::read(path) {
        // Skip first 24 bytes (header), then read UTF-16 path
        if contents.len() > 24 {
            let path_bytes = &contents[24..];
            
            // Convert UTF-16 LE to string
            let path_u16: Vec<u16> = path_bytes
                .chunks_exact(2)
                .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
                .take_while(|&c| c != 0)
                .collect();
            
            return String::from_utf16(&path_u16).ok();
        }
    }
    None
}

/// Resolve .lnk shortcut to target path
fn resolve_lnk_target(lnk_path: &Path) -> Option<String> {
    // Basic LNK parsing - in production, use a proper LNK parser library
    if let Ok(contents) = fs::read(lnk_path) {
        // This is a simplified version - real LNK parsing is complex
        // Look for path-like strings in the file
        if let Ok(contents_str) = String::from_utf8(contents.clone()) {
            // Find Windows paths (C:\... or \\...)
            for line in contents_str.lines() {
                if line.contains(":\\") && line.len() > 3 {
                    // Extract path
                    if let Some(start) = line.find("C:\\").or_else(|| line.find("D:\\")) {
                        if let Some(end) = line[start..].find('\0') {
                            return Some(line[start..start + end].to_string());
                        }
                    }
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_file_activity_collection() {
        let result = collect_file_activity(24);
        assert!(result.is_ok());
        let report = result.unwrap();
        println!("Collected {} activities", report.total_activities);
    }
}
