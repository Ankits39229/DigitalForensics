// Library crate for testing modules
pub mod types;
pub mod logger;
pub mod processes;
pub mod system_info;
pub mod network;
pub mod persistence;
pub mod event_logs;
pub mod prefetch;
pub mod shimcache;
pub mod forensic_types;
pub mod file_activity;

#[cfg(test)]
pub mod test_error_scenarios;