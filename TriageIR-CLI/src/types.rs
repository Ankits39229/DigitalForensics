use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Root structure containing all scan results and metadata
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ScanResults {
    pub scan_metadata: ScanMetadata,
    pub artifacts: Artifacts,
    pub collection_log: Vec<LogEntry>,
}

impl ScanResults {
    /// Create a new ScanResults with initialized metadata
    pub fn new(hostname: String, os_version: String) -> Self {
        let scan_id = uuid::Uuid::new_v4().to_string();
        let scan_start = chrono::Utc::now();
        
        ScanResults {
            scan_metadata: ScanMetadata {
                scan_id,
                scan_start_utc: scan_start.to_rfc3339(),
                scan_duration_ms: 0,
                hostname,
                os_version,
                cli_version: env!("CARGO_PKG_VERSION").to_string(),
            },
            artifacts: Artifacts::default(),
            collection_log: Vec::new(),
        }
    }
    
    /// Update scan duration based on start time
    pub fn finalize_scan(&mut self) {
        if let Ok(start_time) = chrono::DateTime::parse_from_rfc3339(&self.scan_metadata.scan_start_utc) {
            let duration = chrono::Utc::now().signed_duration_since(start_time.with_timezone(&chrono::Utc));
            self.scan_metadata.scan_duration_ms = duration.num_milliseconds().max(0) as u64;
        }
    }
    
    /// Add a log entry to the collection log
    pub fn add_log(&mut self, entry: LogEntry) {
        self.collection_log.push(entry);
    }
    
    /// Validate the scan results structure
    pub fn validate(&self) -> Result<(), String> {
        if self.scan_metadata.scan_id.is_empty() {
            return Err("Scan ID cannot be empty".to_string());
        }
        
        if self.scan_metadata.hostname.is_empty() {
            return Err("Hostname cannot be empty".to_string());
        }
        
        // Validate UUID format
        if uuid::Uuid::parse_str(&self.scan_metadata.scan_id).is_err() {
            return Err("Invalid UUID format for scan_id".to_string());
        }
        
        // Validate timestamp format
        if chrono::DateTime::parse_from_rfc3339(&self.scan_metadata.scan_start_utc).is_err() {
            return Err("Invalid timestamp format for scan_start_utc".to_string());
        }
        
        Ok(())
    }
}

/// Metadata about the forensic scan execution
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ScanMetadata {
    /// Unique identifier for this scan (UUID v4)
    pub scan_id: String,
    /// ISO 8601 timestamp when scan started
    pub scan_start_utc: String,
    /// Total scan duration in milliseconds
    pub scan_duration_ms: u64,
    /// Target system hostname
    pub hostname: String,
    /// Operating system version information
    pub os_version: String,
    /// CLI tool version
    pub cli_version: String,
}

/// Container for all collected forensic artifacts
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct Artifacts {
    pub system_info: SystemInfo,
    pub running_processes: Vec<Process>,
    pub network_connections: Vec<NetworkConnection>,
    pub persistence_mechanisms: Vec<PersistenceMechanism>,
    pub event_logs: EventLogs,
    pub file_activity: Option<crate::file_activity::FileActivityReport>,
}

impl Artifacts {
    /// Get total count of all collected artifacts
    pub fn total_artifact_count(&self) -> usize {
        let mut count = self.running_processes.len() +
        self.network_connections.len() +
        self.persistence_mechanisms.len() +
        self.event_logs.security.len() +
        self.event_logs.system.len() +
        self.event_logs.application.len() +
        self.system_info.logged_on_users.len();
        
        if let Some(ref activity) = self.file_activity {
            count += activity.total_activities;
        }
        
        count
    }
}

/// System information and current state
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct SystemInfo {
    /// System uptime in seconds
    pub uptime_secs: u64,
    /// Currently logged-on users
    pub logged_on_users: Vec<LoggedOnUser>,
}

/// Information about a logged-on user
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LoggedOnUser {
    /// Username
    pub username: String,
    /// Domain or computer name
    pub domain: String,
    /// Logon timestamp (ISO 8601)
    pub logon_time: String,
}

/// Information about a loaded module/DLL in a process
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ProcessModule {
    /// Module name (e.g., "kernel32.dll")
    pub name: String,
    /// Full path to the module file
    pub file_path: String,
    /// Base address where module is loaded
    pub base_address: String,
    /// Size of the module in memory
    pub size: u32,
    /// Module version information (if available)
    pub version: String,
}

impl LoggedOnUser {
    pub fn new(username: String, domain: String, logon_time: String) -> Self {
        LoggedOnUser {
            username,
            domain,
            logon_time,
        }
    }
}

impl ProcessModule {
    pub fn new(name: String, file_path: String, base_address: String, size: u32, version: String) -> Self {
        ProcessModule {
            name,
            file_path,
            base_address,
            size,
            version,
        }
    }
    
    /// Check if this is a system module (located in Windows system directories)
    pub fn is_system_module(&self) -> bool {
        let path_lower = self.file_path.to_lowercase();
        path_lower.contains("\\windows\\system32\\") || 
        path_lower.contains("\\windows\\syswow64\\") ||
        path_lower.contains("\\windows\\winsxs\\")
    }
}

/// Information about a running process
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Process {
    /// Process ID
    pub pid: u32,
    /// Parent process ID
    pub parent_pid: u32,
    /// Process name
    pub name: String,
    /// Full command line
    pub command_line: String,
    /// Path to executable file
    pub executable_path: String,
    /// SHA-256 hash of executable
    pub sha256_hash: String,
    /// User account running the process
    pub user: String,
    /// Memory usage in MB
    pub memory_usage_mb: f64,
    /// Loaded DLLs and modules
    pub loaded_modules: Vec<ProcessModule>,
}

impl Process {
    pub fn new(pid: u32, parent_pid: u32, name: String, command_line: String, executable_path: String) -> Self {
        Process {
            pid,
            parent_pid,
            name,
            command_line,
            executable_path,
            sha256_hash: String::new(), // Will be calculated separately
            user: String::new(), // Will be populated separately
            memory_usage_mb: 0.0, // Will be populated separately
            loaded_modules: Vec::new(), // Will be populated separately
        }
    }
    
    pub fn new_with_user_memory(pid: u32, parent_pid: u32, name: String, command_line: String, executable_path: String, user: String, memory_usage_mb: f64) -> Self {
        Process {
            pid,
            parent_pid,
            name,
            command_line,
            executable_path,
            sha256_hash: String::new(), // Will be calculated separately
            user,
            memory_usage_mb,
            loaded_modules: Vec::new(), // Will be populated separately
        }
    }
    
    /// Check if this process has a valid executable path
    pub fn has_executable_path(&self) -> bool {
        !self.executable_path.is_empty() && self.executable_path != "N/A"
    }
    
    /// Get count of loaded modules
    pub fn module_count(&self) -> usize {
        self.loaded_modules.len()
    }
}

/// Network connection information
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct NetworkConnection {
    /// Protocol type (TCP or UDP)
    pub protocol: String,
    /// Local address and port
    pub local_address: String,
    /// Local port number
    pub local_port: u16,
    /// Remote address and port
    pub remote_address: String,
    /// Remote port number
    pub remote_port: u16,
    /// Connection state (for TCP)
    pub state: String,
    /// Process ID that owns this connection
    pub owning_pid: u32,
    /// Process name that owns this connection
    pub process_name: String,
}

impl NetworkConnection {
    pub fn new(protocol: String, local_address: String, remote_address: String, state: String, owning_pid: u32) -> Self {
        // Extract ports from addresses if they contain them
        let (local_addr, local_port) = extract_address_and_port(&local_address);
        let (remote_addr, remote_port) = extract_address_and_port(&remote_address);
        
        NetworkConnection {
            protocol,
            local_address: local_addr,
            local_port,
            remote_address: remote_addr,
            remote_port,
            state,
            owning_pid,
            process_name: String::new(), // Will be populated separately
        }
    }
    
    pub fn new_with_ports_and_process(protocol: String, local_address: String, local_port: u16, remote_address: String, remote_port: u16, state: String, owning_pid: u32, process_name: String) -> Self {
        NetworkConnection {
            protocol,
            local_address,
            local_port,
            remote_address,
            remote_port,
            state,
            owning_pid,
            process_name,
        }
    }
    
    /// Check if this is an external connection (not localhost)
    pub fn is_external(&self) -> bool {
        !self.remote_address.starts_with("127.0.0.1") &&
        !self.remote_address.starts_with("::1") &&
        !self.remote_address.starts_with("0.0.0.0") &&
        self.remote_address != "*"
    }
}

/// Extract IP address and port from a string like "192.168.1.1:8080"
fn extract_address_and_port(addr_port: &str) -> (String, u16) {
    if let Some(last_colon) = addr_port.rfind(':') {
        let addr = addr_port[..last_colon].to_string();
        let port_str = &addr_port[last_colon + 1..];
        let port = port_str.parse::<u16>().unwrap_or(0);
        (addr, port)
    } else {
        (addr_port.to_string(), 0)
    }
}

/// Persistence mechanism found on the system
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PersistenceMechanism {
    /// Type of persistence mechanism
    #[serde(rename = "type")]
    pub mechanism_type: String,
    /// Name or identifier
    pub name: String,
    /// Command or executable path
    pub command: String,
    /// Source location (registry key, task path, etc.)
    pub source: String,
    /// Location within the source (registry value, file path, etc.)
    pub location: String,
    /// Value of the persistence mechanism
    pub value: String,
    /// Whether this mechanism is suspicious
    pub is_suspicious: bool,
}

impl PersistenceMechanism {
    pub fn new(mechanism_type: String, name: String, command: String, source: String) -> Self {
        PersistenceMechanism {
            mechanism_type,
            name,
            command,
            source,
            location: String::new(), // Will be populated separately
            value: String::new(), // Will be populated separately
            is_suspicious: false, // Will be analyzed separately
        }
    }
    
    pub fn new_with_location_value(mechanism_type: String, name: String, command: String, source: String, location: String, value: String, is_suspicious: bool) -> Self {
        PersistenceMechanism {
            mechanism_type,
            name,
            command,
            source,
            location,
            value,
            is_suspicious,
        }
    }
}

/// Common persistence mechanism types
pub enum PersistenceType {
    RegistryRunKey,
    ScheduledTask,
    Service,
    StartupFolder,
    WMIEventConsumer,
}

impl PersistenceType {
    pub fn as_str(&self) -> &'static str {
        match self {
            PersistenceType::RegistryRunKey => "Registry Run Key",
            PersistenceType::ScheduledTask => "Scheduled Task",
            PersistenceType::Service => "Windows Service",
            PersistenceType::StartupFolder => "Startup Folder",
            PersistenceType::WMIEventConsumer => "WMI Event Consumer",
        }
    }
}

/// Windows Event Log collections
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct EventLogs {
    /// Security event log entries
    pub security: Vec<EventLogEntry>,
    /// System event log entries
    pub system: Vec<EventLogEntry>,
    /// Application event log entries
    pub application: Vec<EventLogEntry>,
}

impl EventLogs {
    /// Get total count of all event log entries
    pub fn total_entries(&self) -> usize {
        self.security.len() + self.system.len() + self.application.len()
    }
}

/// Individual event log entry
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct EventLogEntry {
    /// Windows Event ID
    pub event_id: u32,
    /// Event level (Information, Warning, Error, etc.)
    pub level: String,
    /// Event timestamp (ISO 8601)
    pub timestamp: String,
    /// Event message/description
    pub message: String,
    /// Event log source (Security, System, Application)
    pub source: String,
}

impl EventLogEntry {
    pub fn new(event_id: u32, level: String, timestamp: String, message: String) -> Self {
        EventLogEntry {
            event_id,
            level,
            timestamp,
            message,
            source: "Unknown".to_string(),
        }
    }
    
    pub fn new_with_source(event_id: u32, level: String, timestamp: String, message: String, source: String) -> Self {
        EventLogEntry {
            event_id,
            level,
            timestamp,
            message,
            source,
        }
    }
}

/// Collection log entry for tracking scan progress and issues
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LogEntry {
    /// Timestamp when log entry was created (ISO 8601)
    pub timestamp: String,
    /// Log level (INFO, WARN, ERROR)
    pub level: String,
    /// Log message
    pub message: String,
}

impl LogEntry {
    /// Create a new log entry with current timestamp
    pub fn new(level: &str, message: &str) -> Self {
        LogEntry {
            timestamp: chrono::Utc::now().to_rfc3339(),
            level: level.to_string(),
            message: message.to_string(),
        }
    }
    
    /// Create an INFO level log entry
    pub fn info(message: &str) -> Self {
        Self::new("INFO", message)
    }
    
    /// Create a WARN level log entry
    pub fn warn(message: &str) -> Self {
        Self::new("WARN", message)
    }
    
    /// Create an ERROR level log entry
    pub fn error(message: &str) -> Self {
        Self::new("ERROR", message)
    }
    
    /// Create a log entry with formatted message
    pub fn info_fmt(message: &str, args: &[&str]) -> Self {
        let formatted = args.iter().enumerate().fold(message.to_string(), |acc, (i, arg)| {
            acc.replace(&format!("{{{}}}", i), arg)
        });
        Self::info(&formatted)
    }
}

/// Log levels for collection logging
#[derive(Debug, Clone)]
pub enum LogLevel {
    Info,
    Warn,
    Error,
}

impl LogLevel {
    pub fn as_str(&self) -> &'static str {
        match self {
            LogLevel::Info => "INFO",
            LogLevel::Warn => "WARN",
            LogLevel::Error => "ERROR",
        }
    }
}
#
[cfg(test)]
mod tests {
    use super::*;
    use serde_json;

    #[test]
    fn test_scan_results_creation() {
        let results = ScanResults::new("TEST-HOST".to_string(), "Windows 10".to_string());
        
        assert_eq!(results.scan_metadata.hostname, "TEST-HOST");
        assert_eq!(results.scan_metadata.os_version, "Windows 10");
        assert!(!results.scan_metadata.scan_id.is_empty());
        assert!(!results.scan_metadata.scan_start_utc.is_empty());
        assert_eq!(results.scan_metadata.scan_duration_ms, 0);
    }

    #[test]
    fn test_scan_results_validation() {
        let results = ScanResults::new("TEST-HOST".to_string(), "Windows 10".to_string());
        assert!(results.validate().is_ok());
        
        let mut invalid_results = results.clone();
        invalid_results.scan_metadata.scan_id = "invalid-uuid".to_string();
        assert!(invalid_results.validate().is_err());
    }

    #[test]
    fn test_json_serialization() {
        let results = ScanResults::new("TEST-HOST".to_string(), "Windows 10".to_string());
        
        // Test serialization
        let json = serde_json::to_string(&results).expect("Failed to serialize");
        assert!(!json.is_empty());
        
        // Test deserialization
        let deserialized: ScanResults = serde_json::from_str(&json).expect("Failed to deserialize");
        assert_eq!(deserialized.scan_metadata.hostname, results.scan_metadata.hostname);
    }

    #[test]
    fn test_log_entry_creation() {
        let log = LogEntry::info("Test message");
        assert_eq!(log.level, "INFO");
        assert_eq!(log.message, "Test message");
        assert!(!log.timestamp.is_empty());
        
        let warn_log = LogEntry::warn("Warning message");
        assert_eq!(warn_log.level, "WARN");
        
        let error_log = LogEntry::error("Error message");
        assert_eq!(error_log.level, "ERROR");
    }

    #[test]
    fn test_process_creation() {
        let process = Process::new(1234, 5678, "test.exe".to_string(), "test.exe --arg".to_string(), "C:\\test.exe".to_string());
        
        assert_eq!(process.pid, 1234);
        assert_eq!(process.parent_pid, 5678);
        assert_eq!(process.name, "test.exe");
        assert!(process.has_executable_path());
        assert_eq!(process.module_count(), 0);
    }

    #[test]
    fn test_network_connection_external_detection() {
        let external_conn = NetworkConnection::new(
            "TCP".to_string(),
            "192.168.1.100:12345".to_string(),
            "8.8.8.8:80".to_string(),
            "ESTABLISHED".to_string(),
            1234
        );
        assert!(external_conn.is_external());
        
        let local_conn = NetworkConnection::new(
            "TCP".to_string(),
            "127.0.0.1:12345".to_string(),
            "127.0.0.1:80".to_string(),
            "ESTABLISHED".to_string(),
            1234
        );
        assert!(!local_conn.is_external());
    }

    #[test]
    fn test_persistence_mechanism_creation() {
        let mechanism = PersistenceMechanism::new(
            PersistenceType::RegistryRunKey.as_str().to_string(),
            "TestApp".to_string(),
            "C:\\test.exe".to_string(),
            "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run".to_string()
        );
        
        assert_eq!(mechanism.mechanism_type, "Registry Run Key");
        assert_eq!(mechanism.name, "TestApp");
    }

    #[test]
    fn test_artifacts_count() {
        let mut artifacts = Artifacts::default();
        assert_eq!(artifacts.total_artifact_count(), 0);
        
        artifacts.running_processes.push(Process::new(1, 0, "test".to_string(), "test".to_string(), "test".to_string()));
        artifacts.network_connections.push(NetworkConnection::new("TCP".to_string(), "local".to_string(), "remote".to_string(), "ESTABLISHED".to_string(), 1));
        
        assert_eq!(artifacts.total_artifact_count(), 2);
    }

    #[test]
    fn test_event_logs_count() {
        let mut event_logs = EventLogs::default();
        assert_eq!(event_logs.total_entries(), 0);
        
        event_logs.security.push(EventLogEntry::new_with_source(4624, "Information".to_string(), "2023-01-01T00:00:00Z".to_string(), "Logon".to_string(), "Security".to_string()));
        event_logs.system.push(EventLogEntry::new_with_source(1001, "Information".to_string(), "2023-01-01T00:00:00Z".to_string(), "System".to_string(), "System".to_string()));
        
        assert_eq!(event_logs.total_entries(), 2);
    }
}