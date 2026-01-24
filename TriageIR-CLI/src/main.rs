use clap::{Arg, Command};
use serde_json::json;
use std::fs;
use std::sync::Arc;
use std::env;
use std::path::PathBuf;
use sysinfo::System;

mod types;
mod processes;
mod system_info;
mod network;
mod persistence;
mod event_logs;
mod logger;
mod prefetch;
mod shimcache;
mod forensic_types;
mod file_activity;

#[cfg(test)]
mod integration_tests;

#[cfg(test)]
mod comprehensive_tests;

#[cfg(test)]
mod performance_tests;

use logger::{Logger, error_handling::{ForensicResult, ForensicError, handle_error_gracefully}};
use types::{ScanResults, LogEntry};

fn main() {
    let matches = Command::new("triageir-cli")
        .version(env!("CARGO_PKG_VERSION"))
        .about("Digital Forensics Triage Tool for Windows Systems")
        .long_about("TriageIR-CLI is a forensically sound command-line tool for rapid evidence collection from live Windows systems. It collects system information, running processes, network connections, persistence mechanisms, event logs, and execution evidence.")
        .arg(
            Arg::new("output")
                .short('o')
                .long("output")
                .value_name("FILE")
                .help("Output file for results (default: stdout)")
        )
        .arg(
            Arg::new("verbose")
                .short('v')
                .long("verbose")
                .action(clap::ArgAction::SetTrue)
                .help("Enable verbose output with progress information")
        )
        .arg(
            Arg::new("format")
                .long("format")
                .value_name("FORMAT")
                .default_value("json")
                .help("Output format (currently only 'json' is supported)")
                .value_parser(["json"])
        )
        .arg(
            Arg::new("password")
                .long("password")
                .value_name("PASSWORD")
                .help("Password for encrypted output (future feature)")
        )
        .get_matches();

    let verbose = matches.get_flag("verbose");
    let output_file = matches.get_one::<String>("output");
    let format = matches.get_one::<String>("format").unwrap();
    let _password = matches.get_one::<String>("password"); // For future use
    
    // Detect portable mode
    let portable_mode = env::var("TRIAGEIR_PORTABLE").is_ok();
    let usb_drive = env::var("TRIAGEIR_USB_DRIVE").ok();
    let portable_output_dir = env::var("TRIAGEIR_OUTPUT_DIR").ok();
    
    // Validate format argument
    if format != "json" {
        eprintln!("Error: Only 'json' format is currently supported");
        std::process::exit(1);
    }
    
    let logger = Arc::new(Logger::new(verbose));
    let start_time = std::time::Instant::now();
    
    // Initialize scan results with proper error handling
    let hostname = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "Unknown".to_string());
    let os_version = System::os_version().unwrap_or_else(|| "Unknown".to_string());
    let mut scan_results = ScanResults::new(hostname.clone(), os_version.clone());
    
    let cli_version = env!("CARGO_PKG_VERSION");
    logger.info(&format!("TriageIR CLI v{} - Digital Forensics Triage Tool started", cli_version));
    
    // Log portable mode information
    if portable_mode {
        logger.info("Running in PORTABLE MODE");
        if let Some(ref usb) = usb_drive {
            logger.info(&format!("USB Drive: {}", usb));
        }
        if let Some(ref output_dir) = portable_output_dir {
            logger.info(&format!("Portable Output Directory: {}", output_dir));
        }
    }
    
    logger.info(&format!("Target system: {}", hostname));
    logger.info(&format!("OS Version: {}", os_version));
    logger.info(&format!("Current user: {}", std::env::var("USERNAME").unwrap_or_else(|_| "Unknown".to_string())));
    logger.info(&format!("Verbose mode: {}", verbose));
    logger.info(&format!("Output format: {}", format));
    
    // Handle output file with portable mode support
    let final_output_file = if let Some(output) = output_file {
        let output_path = PathBuf::from(output);
        if portable_mode && output_path.is_relative() {
            // If in portable mode and output is relative, use portable output directory
            if let Some(ref portable_dir) = portable_output_dir {
                let portable_path = PathBuf::from(portable_dir).join(output_path);
                logger.info(&format!("Output file (portable): {}", portable_path.display()));
                Some(portable_path.to_string_lossy().to_string())
            } else {
                logger.info(&format!("Output file: {}", output));
                Some(output.clone())
            }
        } else {
            logger.info(&format!("Output file: {}", output));
            Some(output.clone())
        }
    } else {
        logger.info("Output: stdout");
        None
    };

    if verbose {
        println!("TriageIR CLI v{} - Digital Forensics Triage Tool", cli_version);
        println!("==================================================");
        println!("Starting forensic data collection...");
        println!("Target system: {}", hostname);
        println!("OS Version: {}", os_version);
        println!("Current user: {}", std::env::var("USERNAME").unwrap_or_else(|_| "Unknown".to_string()));
        println!("Scan ID: {}", scan_results.scan_metadata.scan_id);
        println!();
    }

    // Initialize system information collector with error handling
    if verbose {
        println!("🔍 Collecting system information...");
    }
    let system_info_result = collect_system_info_safe(&logger);
    let system_info = match &system_info_result {
        Some(info) => {
            logger.info("System information collected successfully");
            if verbose {
                println!("✓ System information collected");
            }
            info.clone()
        }
        None => {
            logger.error("Failed to collect system information, using defaults");
            if verbose {
                println!("⚠ System information collection failed, using defaults");
            }
            json!({
                "hostname": hostname,
                "os_name": "Unknown",
                "os_version": "Unknown",
                "architecture": std::env::consts::ARCH,
                "current_user": "Unknown",
                "uptime_hours": 0.0,
                "last_boot_time": chrono::Utc::now().to_rfc3339(),
                "total_memory": 0,
                "used_memory": 0,
                "cpu_count": 0,
                "logged_on_users": []
            })
        }
    };
    
    // Collect running processes with comprehensive error handling
    if verbose {
        println!("🔍 Enumerating running processes...");
    }
    logger.info("Starting process enumeration");
    let (processes_data, process_logs) = processes::collect_processes();
    
    // Add process logs to main logger
    for log in &process_logs {
        scan_results.add_log(log.clone());
    }
    
    let processes = processes_data.into_iter().map(|p| {
        json!({
            "pid": p.pid,
            "parent_pid": p.parent_pid,
            "name": p.name,
            "command_line": p.command_line,
            "executable_path": p.executable_path,
            "sha256_hash": p.sha256_hash,
            "user": p.user,
            "memory_usage_mb": p.memory_usage_mb,
            "loaded_modules": p.loaded_modules.into_iter().map(|m| {
                json!({
                    "name": m.name,
                    "file_path": m.file_path,
                    "base_address": m.base_address,
                    "size": m.size,
                    "version": m.version,
                    "is_system_module": m.is_system_module()
                })
            }).collect::<Vec<_>>()
        })
    }).collect::<Vec<_>>();
    
    logger.info(&format!("Process enumeration completed: {} processes collected", processes.len()));
    if verbose {
        println!("✓ Process enumeration completed ({} processes)", processes.len());
    }
    
    // Collect network connections with error handling
    if verbose {
        println!("🔍 Analyzing network connections...");
    }
    logger.info("Starting network connection enumeration");
    let (network_connections_data, network_logs) = network::collect_network_connections();
    
    // Add network logs to main logger
    for log in &network_logs {
        scan_results.add_log(log.clone());
    }
    
    let network_connections = network_connections_data.into_iter().map(|conn| {
        json!({
            "protocol": conn.protocol,
            "local_address": conn.local_address,
            "local_port": conn.local_port,
            "remote_address": conn.remote_address,
            "remote_port": conn.remote_port,
            "state": conn.state,
            "owning_pid": conn.owning_pid,
            "process_name": conn.process_name,
            "is_external": conn.is_external()
        })
    }).collect::<Vec<_>>();
    
    logger.info(&format!("Network enumeration completed: {} connections collected", network_connections.len()));
    if verbose {
        println!("✓ Network analysis completed ({} connections)", network_connections.len());
    }
    
    // Collect persistence mechanisms with error handling
    if verbose {
        println!("🔍 Detecting persistence mechanisms...");
    }
    logger.info("Starting persistence mechanism detection");
    let (persistence_mechanisms_data, persistence_logs) = persistence::collect_persistence_mechanisms();
    
    // Add persistence logs to main logger
    for log in &persistence_logs {
        scan_results.add_log(log.clone());
    }
    
    let persistence_mechanisms = persistence_mechanisms_data.into_iter().map(|p| {
        json!({
            "type": p.mechanism_type,
            "name": p.name,
            "command": p.command,
            "source": p.source,
            "location": p.location,
            "value": p.value,
            "is_suspicious": p.is_suspicious
        })
    }).collect::<Vec<_>>();
    
    logger.info(&format!("Persistence detection completed: {} mechanisms found", persistence_mechanisms.len()));
    if verbose {
        println!("✓ Persistence detection completed ({} mechanisms)", persistence_mechanisms.len());
    }
    
    // Collect event logs with error handling
    if verbose {
        println!("🔍 Collecting event logs...");
    }
    logger.info("Starting event log collection");
    let (event_logs_data, event_logs_collection_logs) = event_logs::collect_event_logs();
    
    // Add event log collection logs to main logger
    for log in &event_logs_collection_logs {
        scan_results.add_log(log.clone());
    }
    
    let total_event_entries = event_logs_data.total_entries();
    let event_logs = json!({
        "security": event_logs_data.security.into_iter().map(|e| {
            json!({
                "event_id": e.event_id,
                "level": e.level,
                "timestamp": e.timestamp,
                "message": e.message,
                "source": e.source
            })
        }).collect::<Vec<_>>(),
        "system": event_logs_data.system.into_iter().map(|e| {
            json!({
                "event_id": e.event_id,
                "level": e.level,
                "timestamp": e.timestamp,
                "message": e.message,
                "source": e.source
            })
        }).collect::<Vec<_>>(),
        "application": event_logs_data.application.into_iter().map(|e| {
            json!({
                "event_id": e.event_id,
                "level": e.level,
                "timestamp": e.timestamp,
                "message": e.message,
                "source": e.source
            })
        }).collect::<Vec<_>>()
    });
    
    logger.info(&format!("Event log collection completed: {} entries collected", total_event_entries));
    if verbose {
        println!("✓ Event log collection completed ({} entries)", total_event_entries);
    }
    
    // Collect execution evidence with error handling
    if verbose {
        println!("🔍 Collecting execution evidence...");
    }
    logger.info("Starting execution evidence collection");
    
    // Collect Prefetch files
    if verbose {
        println!("  📁 Analyzing Prefetch files...");
    }
    let (prefetch_files_data, prefetch_logs) = prefetch::collect_prefetch_files();
    
    // Convert forensic audit entries to log entries
    for audit_entry in &prefetch_logs {
        let duration_str = audit_entry.duration_ms.map_or("N/A".to_string(), |d| d.to_string());
        let log_entry = LogEntry::new(&audit_entry.level, &format!("[{}] {}: {} ({}ms)", 
            audit_entry.component, audit_entry.action, audit_entry.details, duration_str));
        scan_results.add_log(log_entry);
    }
    
    let prefetch_files = prefetch_files_data.into_iter().map(|pf| {
        json!({
            "filename": pf.filename,
            "executable_name": pf.executable_name,
            "run_count": pf.run_count,
            "last_run_time": pf.last_run_time,
            "creation_time": pf.creation_time,
            "file_size": pf.file_size,
            "hash": pf.hash,
            "version": pf.version,
            "referenced_files": pf.referenced_files,
            "volumes": pf.volumes.into_iter().map(|v| {
                json!({
                    "device_path": v.device_path,
                    "volume_name": v.volume_name,
                    "serial_number": v.serial_number,
                    "creation_time": v.creation_time
                })
            }).collect::<Vec<_>>()
        })
    }).collect::<Vec<_>>();
    
    logger.info(&format!("Prefetch analysis completed: {} files analyzed", prefetch_files.len()));
    if verbose {
        println!("  ✓ Prefetch analysis completed ({} files)", prefetch_files.len());
    }
    
    // Collect Shimcache entries
    if verbose {
        println!("  📁 Analyzing Shimcache entries...");
    }
    let (shimcache_entries_data, shimcache_logs) = shimcache::collect_shimcache_entries();
    
    // Convert forensic audit entries to log entries
    for audit_entry in &shimcache_logs {
        let duration_str = audit_entry.duration_ms.map_or("N/A".to_string(), |d| d.to_string());
        let log_entry = LogEntry::new(&audit_entry.level, &format!("[{}] {}: {} ({}ms)", 
            audit_entry.component, audit_entry.action, audit_entry.details, duration_str));
        scan_results.add_log(log_entry);
    }
    
    let shimcache_entries = shimcache_entries_data.into_iter().map(|sc| {
        json!({
            "path": sc.path,
            "last_modified": sc.last_modified,
            "file_size": sc.file_size,
            "last_update": sc.last_update,
            "execution_flag": sc.execution_flag
        })
    }).collect::<Vec<_>>();
    
    logger.info(&format!("Shimcache analysis completed: {} entries collected", shimcache_entries.len()));
    if verbose {
        println!("  ✓ Shimcache analysis completed ({} entries)", shimcache_entries.len());
        println!("✓ Execution evidence collection completed");
    }
    
    // Collect file activity (last 24 hours)
    logger.info("Starting file activity collection (last 24 hours)");
    if verbose {
        println!();
        println!("⏱ Collecting file activity (last 24 hours)...");
    }
    
    let file_activity_result = file_activity::collect_file_activity(24);
    let file_activity_data = match file_activity_result {
        Ok(report) => {
            logger.info(&format!("File activity collection completed: {} activities found", report.total_activities));
            if verbose {
                println!("  ✓ File activity collection completed ({} activities)", report.total_activities);
                for (action, count) in &report.activities_by_type {
                    println!("    - {}: {}", action, count);
                }
            }
            Some(report)
        }
        Err(e) => {
            logger.error(&format!("File activity collection failed: {}", e));
            if verbose {
                println!("  ✗ File activity collection failed: {}", e);
            }
            None
        }
    };
    
    let total_file_activities = file_activity_data.as_ref().map_or(0, |fa| fa.total_activities);
    let total_artifacts = processes.len() + network_connections.len() + persistence_mechanisms.len() + total_event_entries + prefetch_files.len() + shimcache_entries.len() + total_file_activities;
    
    let duration = start_time.elapsed();
    logger.info(&format!("Scan completed in {:.2} seconds", duration.as_secs_f64()));
    logger.info(&format!("Total artifacts collected: {}", total_artifacts));
    
    // Get logger summary for final reporting
    let log_summary = logger.get_summary();
    logger.info(&format!("Collection summary - Total logs: {}, Errors: {}, Warnings: {}, Success rate: {:.1}%", 
        log_summary.total_count, log_summary.error_count, log_summary.warn_count, log_summary.success_rate()));
    
    if verbose {
        println!();
        println!("📊 Collection Summary:");
        println!("====================");
        println!("✓ System information collected");
        println!("✓ Running processes enumerated ({} processes)", processes.len());
        println!("✓ Network connections analyzed ({} connections)", network_connections.len());
        println!("✓ Persistence mechanisms detected ({} mechanisms)", persistence_mechanisms.len());
        println!("✓ Event logs collected ({} entries)", total_event_entries);
        println!("✓ Prefetch files analyzed ({} files)", prefetch_files.len());
        println!("✓ Shimcache entries collected ({} entries)", shimcache_entries.len());
        println!("✓ File activity tracked ({} activities)", total_file_activities);
        println!();
        
        if log_summary.has_errors() {
            println!("⚠ {} errors encountered during collection", log_summary.error_count);
        }
        if log_summary.has_warnings() {
            println!("⚠ {} warnings generated during collection", log_summary.warn_count);
        }
        
        println!("Scan completed in {:.2} seconds", duration.as_secs_f64());
        println!("Total artifacts collected: {}", total_artifacts);
        println!();
    }
    
    // Finalize scan results with proper metadata
    scan_results.finalize_scan();
    
    // Add all logger entries to the scan results
    for entry in logger.get_entries() {
        scan_results.add_log(entry);
    }
    
    // Create comprehensive scan results JSON according to design document schema
    let final_scan_results = json!({
        "scan_metadata": {
            "scan_id": scan_results.scan_metadata.scan_id,
            "scan_start_utc": scan_results.scan_metadata.scan_start_utc,
            "scan_duration_ms": duration.as_millis() as u64,
            "hostname": hostname,
            "os_version": scan_results.scan_metadata.os_version,
            "cli_version": scan_results.scan_metadata.cli_version,
            "total_artifacts": total_artifacts,
            "collection_summary": {
                "total_logs": log_summary.total_count,
                "error_count": log_summary.error_count,
                "warning_count": log_summary.warn_count,
                "success_rate": log_summary.success_rate()
            }
        },
        "artifacts": {
            "system_info": system_info,
            "running_processes": processes,
            "network_connections": network_connections,
            "persistence_mechanisms": persistence_mechanisms,
            "event_logs": event_logs,
            "execution_evidence": {
                "prefetch_files": prefetch_files,
                "shimcache_entries": shimcache_entries
            },
            "file_activity": file_activity_data
        },
        "collection_log": scan_results.collection_log.into_iter().map(|log| {
            json!({
                "timestamp": log.timestamp,
                "level": log.level,
                "message": log.message
            })
        }).collect::<Vec<_>>()
    });

    // Output results with comprehensive error handling
    if verbose {
        println!("📝 Generating output...");
    }
    
    match serde_json::to_string_pretty(&final_scan_results) {
        Ok(json_output) => {
            if let Some(output_file) = output_file {
                match write_output_file(output_file, &json_output, &logger) {
                    Ok(_) => {
                        logger.info(&format!("Results written to file: {}", output_file));
                        if verbose {
                            println!("✓ Results written to: {}", output_file);
                            println!("File size: {} bytes", json_output.len());
                        }
                    }
                    Err(e) => {
                        logger.error(&format!("Failed to write output file: {}", e));
                        eprintln!("✗ Error writing to file: {}", e);
                        std::process::exit(1);
                    }
                }
            } else {
                // Output to stdout
                println!("{}", json_output);
            }
        }
        Err(e) => {
            logger.error(&format!("Failed to serialize scan results: {}", e));
            eprintln!("✗ Error serializing results: {}", e);
            std::process::exit(1);
        }
    }

    // Final status reporting (only if not outputting to stdout)
    if output_file.is_some() {
        if verbose {
            println!();
            println!("🎉 Scan completed successfully!");
            println!("Duration: {:.2} seconds", duration.as_secs_f64());
            println!("Total artifacts: {}", total_artifacts);
            println!("Collection logs: {} entries ({} errors, {} warnings)", 
                log_summary.total_count, log_summary.error_count, log_summary.warn_count);
        } else {
            eprintln!("Scan completed in {:.2} seconds", duration.as_secs_f64());
            eprintln!("Total artifacts collected: {}", total_artifacts);
            if log_summary.has_errors() || log_summary.has_warnings() {
                eprintln!("Collection completed with {} errors and {} warnings", 
                    log_summary.error_count, log_summary.warn_count);
            }
        }
    }
    
    // Exit with appropriate code based on collection success
    if log_summary.error_count > 0 {
        std::process::exit(2); // Partial success with errors
    }
}

/// Collect system information with comprehensive error handling
fn collect_system_info_safe(logger: &Logger) -> Option<serde_json::Value> {
    let operation = || -> ForensicResult<serde_json::Value> {
        let mut sys = System::new_all();
        sys.refresh_all();

        // Use the dedicated collector to include logged-on users and uptime
        let (basic_info, collection_logs) = system_info::collect_system_info();
        for entry in collection_logs {
            match entry.level.as_str() {
                "ERROR" => logger.error(&entry.message),
                "WARN" => logger.warn(&entry.message),
                _ => logger.info(&entry.message),
            }
        }
        
        let hostname = std::env::var("COMPUTERNAME")
            .map_err(|_| ForensicError::system_api_error("Failed to get hostname"))?;
        let username = std::env::var("USERNAME")
            .map_err(|_| ForensicError::system_api_error("Failed to get username"))?;
        
        let boot_time = System::boot_time();
        let uptime = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| ForensicError::system_api_error("Failed to calculate uptime"))?
            .as_secs() - boot_time;
        
        Ok(json!({
            "hostname": hostname,
            "os_name": System::name().unwrap_or_else(|| "Windows_NT".to_string()),
            "os_version": System::os_version().unwrap_or_else(|| "Unknown".to_string()),
            "architecture": std::env::consts::ARCH,
            "current_user": username,
            "uptime_hours": (uptime as f64) / 3600.0,
            "uptime_secs": uptime,
            "last_boot_time": chrono::DateTime::from_timestamp(boot_time as i64, 0)
                .unwrap_or_else(|| chrono::Utc::now())
                .to_rfc3339(),
            "total_memory": sys.total_memory(),
            "used_memory": sys.used_memory(),
            "cpu_count": sys.cpus().len(),
            "logged_on_users": basic_info.logged_on_users.into_iter().map(|u| {
                json!({
                    "username": u.username,
                    "domain": u.domain,
                    "logon_time": u.logon_time
                })
            }).collect::<Vec<_>>()
        }))
    };
    
    handle_error_gracefully(operation(), logger, "system_info_collection")
}

/// Write output file with proper error handling and logging
fn write_output_file(output_file: &str, content: &str, logger: &Logger) -> ForensicResult<()> {
    logger.info(&format!("Writing output to file: {}", output_file));
    
    // Validate file path and create parent directories if needed
    let path = std::path::Path::new(output_file);
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            logger.info(&format!("Creating parent directory: {:?}", parent));
            std::fs::create_dir_all(parent)
                .map_err(|e| ForensicError::system_api_error(&format!("Failed to create parent directory: {}", e)))?;
        }
    }
    
    // Write file with error handling
    fs::write(output_file, content)
        .map_err(|e| ForensicError::system_api_error(&format!("Failed to write file: {}", e)))?;
    
    // Verify file was written correctly
    let written_size = fs::metadata(output_file)
        .map_err(|e| ForensicError::system_api_error(&format!("Failed to verify file: {}", e)))?
        .len();
    
    if written_size != content.len() as u64 {
        return Err(ForensicError::invalid_data("File size mismatch after write"));
    }
    
    logger.info(&format!("Successfully wrote {} bytes to {}", written_size, output_file));
    Ok(())
}





