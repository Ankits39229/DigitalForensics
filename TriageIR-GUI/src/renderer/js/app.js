// TriageIR GUI - Clean and Functional Application
const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

class TriageIRApp {
    constructor() {
        this.currentScanData = null;
        this.isScanning = false;
        this.cliStatus = null;
        this.currentPage = 1;
        this.itemsPerPage = 50;
        this.currentTab = 'processes';
        this.AUTOSAVE_KEY = 'triageir_autosave';
        this.RECENT_FILES_KEY = 'triageir_recent_files';
        
        this.init();
    }

    async init() {
        console.log('Initializing TriageIR GUI...');
        
        // Check for autosaved session
        this.checkAutosave();
        
        // Set up event listeners
        this.setupEventListeners();
        
        // Check CLI status
        await this.checkCLIStatus();
        
        // Set up IPC listeners
        this.setupIPCListeners();
        
        // Set up autosave interval
        this.setupAutosave();
        
        console.log('TriageIR GUI initialized successfully');
    }

    setupEventListeners() {
        // Window control buttons with defensive event handling
        const minimizeBtn = document.getElementById('minimizeBtn');
        const maximizeBtn = document.getElementById('maximizeBtn');
        const closeBtn = document.getElementById('closeBtn');
        
        if (minimizeBtn) {
            // Use capture phase to ensure we catch the event first
            minimizeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                console.log('Minimize button clicked');
                ipcRenderer.send('window-minimize');
            }, true);
        }
        
        if (maximizeBtn) {
            maximizeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                console.log('Maximize button clicked');
                ipcRenderer.send('window-maximize');
            }, true);
        }
        
        if (closeBtn) {
            // Multiple event handlers for redundancy
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                console.log('Close button clicked');
                ipcRenderer.send('window-close');
            }, true);
            
            // Backup handler for mousedown
            closeBtn.addEventListener('mousedown', (e) => {
                if (e.button === 0) { // Left click only
                    e.stopPropagation();
                    e.preventDefault();
                }
            }, true);
            
            // Backup handler for mouseup
            closeBtn.addEventListener('mouseup', (e) => {
                if (e.button === 0) { // Left click only
                    console.log('Close button mouseup (backup handler)');
                    ipcRenderer.send('window-close');
                }
            }, true);
        } else {
            console.error('Close button not found in DOM');
        }

        // Welcome screen buttons
        document.getElementById('quickScanBtn').addEventListener('click', () => {
            this.startQuickScan();
        });
        
        document.getElementById('customScanBtn').addEventListener('click', () => {
            this.showCustomScanModal();
        });
        
        document.getElementById('openFileBtn').addEventListener('click', () => {
            this.openResultsFile();
        });

        // Scan screen buttons
        document.getElementById('cancelScanBtn').addEventListener('click', () => {
            this.cancelScan();
        });

        // Results screen buttons
        document.getElementById('newScanBtn').addEventListener('click', () => {
            this.showWelcomeScreen();
        });
        
        document.getElementById('saveResultsBtn').addEventListener('click', () => {
            this.saveResults();
        });
        
        document.getElementById('exportReportBtn').addEventListener('click', () => {
            this.exportReport();
        });

        // Tab buttons
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tab = e.target.dataset.tab;
                this.currentTab = tab;
                this.currentPage = 1; // Reset pagination when switching tabs
                this.switchTab(tab);
            });
        });

        // Custom scan modal
        document.getElementById('closeModalBtn').addEventListener('click', () => {
            document.getElementById('customScanModal').classList.add('hidden');
        });
        
        document.getElementById('cancelConfigBtn').addEventListener('click', () => {
            document.getElementById('customScanModal').classList.add('hidden');
        });
        
        document.getElementById('startConfiguredScanBtn').addEventListener('click', () => {
            this.startConfiguredScan();
        });

        // Error modal
        document.getElementById('closeErrorBtn').addEventListener('click', () => {
            document.getElementById('errorModal').classList.add('hidden');
        });
        
        document.getElementById('closeErrorOkBtn').addEventListener('click', () => {
            document.getElementById('errorModal').classList.add('hidden');
        });
        
        document.getElementById('copyErrorBtn').addEventListener('click', () => {
            this.copyErrorDetails();
        });
    }

    setupIPCListeners() {
        // Listen for scan progress updates
        ipcRenderer.on('scan-progress', (event, message) => {
            this.updateScanProgress(message);
        });
    }

    async checkCLIStatus() {
        try {
            this.cliStatus = await ipcRenderer.invoke('check-cli-status');
            this.updateCLIStatusDisplay();
        } catch (error) {
            console.error('Failed to check CLI status:', error);
            this.cliStatus = { available: false, version: null, path: null };
            this.updateCLIStatusDisplay();
        }
    }

    updateCLIStatusDisplay() {
        const statusIndicator = document.getElementById('statusIndicator');
        const statusText = document.getElementById('statusText');
        
        if (this.cliStatus.available) {
            statusIndicator.innerHTML = '<i data-lucide="check-circle" style="width: 12px; height: 12px; color: #107C10;"></i>';
            statusText.textContent = `CLI Ready (${this.cliStatus.version})`;
            statusText.className = 'status-text text-success';
        } else {
            statusIndicator.innerHTML = '<i data-lucide="x-circle" style="width: 12px; height: 12px; color: #D13438;"></i>';
            statusText.textContent = 'CLI Not Available';
            statusText.className = 'status-text text-error';
        }
        
        // Reinitialize Lucide icons
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }

    async startQuickScan() {
        if (!this.cliStatus.available) {
            this.showError({
                category: 'CLI Not Available',
                message: 'The TriageIR CLI is not available or not found.',
                remedy: 'Please ensure triageir-cli.exe is in the correct location and try again.',
                technical: `Expected CLI path: ${this.cliStatus.path || 'Unknown'}`
            });
            return;
        }

        this.showScanScreen();
        this.isScanning = true;
        
        try {
            const result = await ipcRenderer.invoke('start-scan', {
                verbose: true
            });
            
            if (result.success) {
                // Validate data before displaying
                const validationResult = this.validateScanData(result.data);
                if (!validationResult.valid) {
                    this.showError({
                        category: 'Data Validation Warning',
                        message: 'The scan completed but the data contains validation warnings.',
                        remedy: validationResult.errors.join('; '),
                        technical: JSON.stringify(validationResult.warnings, null, 2)
                    });
                }
                
                this.currentScanData = result.data;
                this.autosaveScanData();
                this.showResultsScreen();
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            console.error('Scan failed:', error);
            
            // Don't show error if scan was cancelled by user
            if (!error.cancelled) {
                this.showError({
                    category: 'Scan Execution Error',
                    message: 'The scan failed to complete successfully.',
                    remedy: 'Check that you have Administrator privileges and try again. If the problem persists, check the technical details below.',
                    technical: error.stdout || error.message || JSON.stringify(error, null, 2)
                });
            }
            this.showWelcomeScreen();
        } finally {
            this.isScanning = false;
        }
    }

    async startCustomScan() {
        // This method is deprecated - use showCustomScanModal instead
        this.showCustomScanModal();
    }

    showCustomScanModal() {
        if (!this.cliStatus.available) {
            this.showError({
                category: 'CLI Not Available',
                message: 'The TriageIR CLI is not available or not found.',
                remedy: 'Please ensure triageir-cli.exe is in the correct location and try again.',
                technical: `Expected CLI path: ${this.cliStatus.path || 'Unknown'}`
            });
            return;
        }
        
        document.getElementById('customScanModal').classList.remove('hidden');
    }

    async startConfiguredScan() {
        document.getElementById('customScanModal').classList.add('hidden');
        
        const options = {
            verbose: document.getElementById('verboseCheck').checked,
            skipHashes: document.getElementById('skipHashesCheck').checked,
            skipEvents: document.getElementById('skipEventsCheck').checked,
            maxEvents: parseInt(document.getElementById('maxEventsInput').value)
        };
        
        this.showScanScreen();
        this.isScanning = true;
        
        try {
            const result = await ipcRenderer.invoke('start-scan', options);
            
            if (result.success) {
                // Validate data before displaying
                const validationResult = this.validateScanData(result.data);
                if (!validationResult.valid) {
                    this.showError({
                        category: 'Data Validation Error',
                        message: 'The scan completed but the data contains validation errors.',
                        remedy: validationResult.errors.join('; '),
                        technical: JSON.stringify(validationResult.warnings, null, 2)
                    });
                }
                
                this.currentScanData = result.data;
                this.autosaveScanData();
                this.showResultsScreen();
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            console.error('Scan failed:', error);
            
            // Don't show error if scan was cancelled by user
            if (!error.cancelled) {
                this.showError({
                    category: 'Scan Execution Error',
                    message: 'The scan failed to complete successfully.',
                    remedy: 'Check that you have Administrator privileges and try again.',
                    technical: error.stdout || error.message || JSON.stringify(error, null, 2)
                });
            }
            this.showWelcomeScreen();
        } finally {
            this.isScanning = false;
        }
    }

    async openResultsFile() {
        try {
            const result = await ipcRenderer.invoke('open-file-dialog');
            
            if (!result.canceled && result.filePaths.length > 0) {
                const filePath = result.filePaths[0];
                const jsonData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                
                this.currentScanData = jsonData;
                this.showResultsScreen();
            }
        } catch (error) {
            console.error('Failed to open file:', error);
            alert(`Failed to open file: ${error.message}`);
        }
    }

    async cancelScan() {
        if (!this.isScanning) {
            return;
        }
        
        // Show custom confirmation modal instead of browser confirm
        return new Promise((resolve) => {
            const confirmModal = document.getElementById('confirmationModal');
            const confirmOKBtn = document.getElementById('confirmCancelOK');
            const confirmAbortBtn = document.getElementById('confirmCancelAbort');
            
            if (!confirmModal) {
                console.error('Confirmation modal not found');
                resolve();
                return;
            }
            
            // Show modal
            confirmModal.classList.remove('hidden');
            
            // Handle confirm
            const handleConfirm = async () => {
                confirmModal.classList.add('hidden');
                removeListeners();
                resolve(true);
                await this.performScanCancellation();
            };
            
            // Handle abort
            const handleAbort = () => {
                confirmModal.classList.add('hidden');
                removeListeners();
                resolve(false);
                console.log('Scan cancellation aborted by user');
            };
            
            // Clean up listeners
            const removeListeners = () => {
                confirmOKBtn.removeEventListener('click', handleConfirm);
                confirmAbortBtn.removeEventListener('click', handleAbort);
            };
            
            // Attach listeners
            confirmOKBtn.addEventListener('click', handleConfirm);
            confirmAbortBtn.addEventListener('click', handleAbort);
        });
    }

    async performScanCancellation() {
        try {
            // Update UI to show cancellation in progress
            const progressText = document.getElementById('progressText');
            const progressFill = document.getElementById('progressFill');
            const logContent = document.getElementById('logContent');
            
            if (progressText) {
                progressText.textContent = 'Cancelling scan...';
            }
            if (progressFill) {
                progressFill.style.width = '0%';
            }
            if (logContent) {
                logContent.textContent += '\n⚠️ Scan cancellation requested by user...\n';
                logContent.textContent += '🛑 Terminating CLI process...\n';
                logContent.scrollTop = logContent.scrollHeight;
            }
            
            // Request scan cancellation from main process
            const result = await ipcRenderer.invoke('cancel-scan');
            
            if (logContent) {
                if (result.success) {
                    logContent.textContent += '✓ Scan process terminated successfully\n';
                    logContent.textContent += '🧹 Cleaning up temporary files...\n';
                    logContent.textContent += '✓ Cleanup complete\n';
                } else {
                    logContent.textContent += '⚠️ No active scan process found\n';
                }
                logContent.scrollTop = logContent.scrollHeight;
            }
            
            // Wait a moment to let user see the cleanup messages
            await new Promise(resolve => setTimeout(resolve, 800));
            
            if (result.success) {
                console.log('Scan cancelled successfully');
            } else {
                console.warn('No active scan to cancel');
            }
            
            this.isScanning = false;
            this.showWelcomeScreen();
            
        } catch (error) {
            console.error('Failed to cancel scan:', error);
            // Force return to welcome screen anyway
            this.isScanning = false;
            this.showWelcomeScreen();
        }
    }

    async saveResults() {
        if (!this.currentScanData) {
            alert('No scan data to save');
            return;
        }

        try {
            const result = await ipcRenderer.invoke('save-file-dialog');
            
            if (!result.canceled && result.filePath) {
                fs.writeFileSync(result.filePath, JSON.stringify(this.currentScanData, null, 2));
                alert('Results saved successfully!');
            }
        } catch (error) {
            console.error('Failed to save results:', error);
            alert(`Failed to save results: ${error.message}`);
        }
    }

    exportReport() {
        if (!this.currentScanData) {
            alert('No scan data to export');
            return;
        }

        // Simple HTML report export
        const html = this.generateHTMLReport(this.currentScanData);
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `triageir-report-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.html`;
        a.click();
        
        URL.revokeObjectURL(url);
    }

    generateHTMLReport(data) {
        return `
<!DOCTYPE html>
<html>
<head>
    <title>TriageIR Forensic Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #f0f0f0; padding: 20px; border-radius: 5px; }
        .section { margin: 20px 0; }
        table { width: 100%; border-collapse: collapse; margin: 10px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
        .summary { background: #e8f4fd; padding: 15px; border-radius: 5px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>TriageIR Forensic Report</h1>
        <p><strong>Generated:</strong> ${new Date().toISOString()}</p>
        <p><strong>Hostname:</strong> ${data.scan_metadata?.hostname || 'Unknown'}</p>
        <p><strong>Scan Duration:</strong> ${data.scan_metadata?.scan_duration_ms || 0}ms</p>
    </div>
    
    <div class="summary">
        <h2>Summary</h2>
        <p><strong>Processes:</strong> ${data.artifacts?.running_processes?.length || 0}</p>
        <p><strong>Network Connections:</strong> ${data.artifacts?.network_connections?.length || 0}</p>
        <p><strong>Persistence Mechanisms:</strong> ${data.artifacts?.persistence_mechanisms?.length || 0}</p>
    </div>
    
    <div class="section">
        <h2>System Information</h2>
        <p><strong>Uptime:</strong> ${data.artifacts?.system_info?.uptime_secs || 0} seconds</p>
        <p><strong>Logged Users:</strong> ${data.artifacts?.system_info?.logged_on_users?.length || 0}</p>
    </div>
    
    <div class="section">
        <h2>Running Processes</h2>
        <table>
            <tr><th>PID</th><th>Name</th><th>Command Line</th></tr>
            ${(data.artifacts?.running_processes || []).slice(0, 50).map(proc => 
                `<tr><td>${proc.pid}</td><td>${proc.name}</td><td>${proc.command_line || ''}</td></tr>`
            ).join('')}
        </table>
    </div>
    
    <div class="section">
        <h2>Network Connections</h2>
        <table>
            <tr><th>Protocol</th><th>Local</th><th>Remote</th><th>State</th></tr>
            ${(data.artifacts?.network_connections || []).slice(0, 50).map(conn => 
                `<tr><td>${conn.protocol}</td><td>${conn.local_address}</td><td>${conn.remote_address}</td><td>${conn.state}</td></tr>`
            ).join('')}
        </table>
    </div>
</body>
</html>`;
    }

    showWelcomeScreen() {
        document.getElementById('welcomeScreen').classList.remove('hidden');
        document.getElementById('scanScreen').classList.add('hidden');
        document.getElementById('resultsScreen').classList.add('hidden');
        this.updateFooterStatus('Ready');
    }

    showScanScreen() {
        document.getElementById('welcomeScreen').classList.add('hidden');
        document.getElementById('scanScreen').classList.remove('hidden');
        document.getElementById('resultsScreen').classList.add('hidden');
        this.updateFooterStatus('Scanning...');
        
        // Reset progress
        document.getElementById('progressFill').style.width = '0%';
        document.getElementById('progressText').textContent = 'Initializing scan...';
        document.getElementById('logContent').textContent = '';
    }

    showResultsScreen() {
        document.getElementById('welcomeScreen').classList.add('hidden');
        document.getElementById('scanScreen').classList.add('hidden');
        document.getElementById('resultsScreen').classList.remove('hidden');
        this.updateFooterStatus('Results loaded');
        
        // Populate results
        this.populateResults();
    }

    updateScanProgress(message) {
        const logContent = document.getElementById('logContent');
        const progressText = document.getElementById('progressText');
        const progressFill = document.getElementById('progressFill');
        
        // Add message to log
        logContent.textContent += message + '\n';
        logContent.scrollTop = logContent.scrollHeight;
        
        // Update progress text
        progressText.textContent = message;
        
        // Data-driven progress based on scan stages
        const stages = {
            // Stage detection patterns and their progress values
            'Collecting system information': 10,
            'system_info': 10,
            'Enumerating running processes': 25,
            'processes': 25,
            'Collecting network connections': 40,
            'network': 40,
            'Analyzing persistence mechanisms': 60,
            'persistence': 60,
            'Collecting event logs': 75,
            'event_logs': 75,
            'events': 75,
            'Collecting execution evidence': 85,
            'execution': 85,
            'prefetch': 85,
            'shimcache': 90,
            'Finalizing scan': 95,
            'Writing output': 95,
            'Scan complete': 100,
            'SUCCESS': 100
        };
        
        // Check message against stage patterns
        let progressValue = parseInt(progressFill.style.width) || 0;
        const messageLower = message.toLowerCase();
        
        for (const [pattern, value] of Object.entries(stages)) {
            if (messageLower.includes(pattern.toLowerCase())) {
                // Only update if new stage is ahead of current progress
                if (value > progressValue) {
                    progressValue = value;
                    break;
                }
            }
        }
        
        // Smooth progress update
        progressFill.style.width = progressValue + '%';
    }

    populateResults() {
        if (!this.currentScanData) return;
        
        console.log('Populating results with data:', this.currentScanData);
        
        // Populate summary cards
        this.populateSummaryCards();
        
        // Populate overview
        this.populateOverview();
        
        // Populate system info
        this.populateSystemInfo();
        
        // Populate processes table
        this.populateProcessesTable();
        
        // Populate network table
        this.populateNetworkTable();
        
        // Populate persistence table
        this.populatePersistenceTable();
        
        // Populate events table
        this.populateEventsTable();
    }

    populateSummaryCards() {
        const summaryCards = document.getElementById('summaryCards');
        const data = this.currentScanData;
        
        // Handle both old and new data structures
        const processes = data.artifacts?.running_processes || [];
        const connections = data.artifacts?.network_connections || [];
        const persistence = data.artifacts?.persistence_mechanisms || [];
        
        // Handle event_logs as object with application, security, system arrays
        const eventLogs = data.artifacts?.event_logs || {};
        const totalEvents = (eventLogs.application || []).length + 
                           (eventLogs.security || []).length + 
                           (eventLogs.system || []).length;
        
        summaryCards.innerHTML = `
            <div class="summary-card">
                <h3>Processes</h3>
                <div class="value">${processes.length}</div>
            </div>
            <div class="summary-card">
                <h3>Network Connections</h3>
                <div class="value">${connections.length}</div>
            </div>
            <div class="summary-card">
                <h3>Persistence Items</h3>
                <div class="value">${persistence.length}</div>
            </div>
            <div class="summary-card">
                <h3>Event Logs</h3>
                <div class="value">${totalEvents}</div>
            </div>
        `;
    }

    populateOverview() {
        const overviewContent = document.getElementById('overviewContent');
        const data = this.currentScanData;
        
        // Handle the actual CLI data structure
        const metadata = data.scan_metadata || {};
        const systemInfo = data.artifacts?.system_info || {};
        
        overviewContent.innerHTML = `
            <div class="overview-info">
                <h4>Scan Information</h4>
                <p><strong>Hostname:</strong> ${metadata.hostname || systemInfo.hostname || 'Unknown'}</p>
                <p><strong>Current User:</strong> ${systemInfo.current_user || 'Unknown'}</p>
                <p><strong>OS Version:</strong> ${systemInfo.os_version || 'Unknown'}</p>
                <p><strong>Architecture:</strong> ${systemInfo.architecture || 'Unknown'}</p>
                <p><strong>Scan Duration:</strong> ${metadata.scan_duration_seconds ? (metadata.scan_duration_seconds * 1000).toFixed(2) + 'ms' : 'Unknown'}</p>
                <p><strong>CLI Version:</strong> ${metadata.version || 'Unknown'}</p>
                <p><strong>Timestamp:</strong> ${metadata.timestamp || 'Unknown'}</p>
                <p><strong>Total Artifacts:</strong> ${metadata.total_artifacts || 'Unknown'}</p>
            </div>
        `;
    }

    populateSystemInfo() {
        const systemContent = document.getElementById('systemContent');
        const systemInfo = this.currentScanData.artifacts?.system_info;
        
        if (!systemInfo) {
            systemContent.innerHTML = '<p>No system information available</p>';
            return;
        }
        
        systemContent.innerHTML = `
            <div class="system-info">
                <h4>System Details</h4>
                <p><strong>Hostname:</strong> ${systemInfo.hostname || 'Unknown'}</p>
                <p><strong>Current User:</strong> ${systemInfo.current_user || 'Unknown'}</p>
                <p><strong>OS Name:</strong> ${systemInfo.os_name || 'Unknown'}</p>
                <p><strong>OS Version:</strong> ${systemInfo.os_version || 'Unknown'}</p>
                <p><strong>Architecture:</strong> ${systemInfo.architecture || 'Unknown'}</p>
                <p><strong>Uptime:</strong> ${systemInfo.uptime_hours ? systemInfo.uptime_hours.toFixed(1) + ' hours' : 'Unknown'}</p>
                <p><strong>Last Boot:</strong> ${systemInfo.last_boot_time || 'Unknown'}</p>
            </div>
        `;
    }

    populateProcessesTable() {
        const tableBody = document.getElementById('processesTableBody');
        const processes = this.currentScanData.artifacts?.running_processes || [];
        
        const start = (this.currentPage - 1) * this.itemsPerPage;
        const end = start + this.itemsPerPage;
        const pageData = processes.slice(start, end);
        
        tableBody.innerHTML = pageData.map(proc => `
            <tr>
                <td>${proc.pid || 'N/A'}</td>
                <td>${proc.name || 'N/A'}</td>
                <td>${proc.user || 'N/A'}</td>
                <td>${proc.memory_usage_mb ? proc.memory_usage_mb.toFixed(1) : 'N/A'}</td>
                <td title="${proc.command_line || ''}">${(proc.command_line || '').substring(0, 50)}${(proc.command_line || '').length > 50 ? '...' : ''}</td>
            </tr>
        `).join('');
        
        this.addPaginationInfo('processesTable', processes.length);
    }

    populateNetworkTable() {
        const tableBody = document.getElementById('networkTableBody');
        const connections = this.currentScanData.artifacts?.network_connections || [];
        
        const start = (this.currentPage - 1) * this.itemsPerPage;
        const end = start + this.itemsPerPage;
        const pageData = connections.slice(start, end);
        
        tableBody.innerHTML = pageData.map(conn => `
            <tr>
                <td>${conn.protocol || 'N/A'}</td>
                <td>${conn.local_address || 'N/A'}</td>
                <td>${conn.local_port || 'N/A'}</td>
                <td>${conn.remote_address || 'N/A'}</td>
                <td>${conn.remote_port || 'N/A'}</td>
                <td>${conn.state || 'N/A'}</td>
                <td>${conn.pid || conn.process_name || 'N/A'}</td>
            </tr>
        `).join('');
        
        this.addPaginationInfo('networkTable', connections.length);
    }

    populatePersistenceTable() {
        const tableBody = document.getElementById('persistenceTableBody');
        const persistence = this.currentScanData.artifacts?.persistence_mechanisms || [];
        
        const start = (this.currentPage - 1) * this.itemsPerPage;
        const end = start + this.itemsPerPage;
        const pageData = persistence.slice(start, end);
        
        tableBody.innerHTML = pageData.map(item => {
            const suspiciousIcon = item.is_suspicious 
                ? '<i data-lucide="alert-triangle" style="width: 14px; height: 14px; color: #F7630C;"></i> Yes' 
                : '<i data-lucide="check" style="width: 14px; height: 14px; color: #107C10;"></i> No';
            return `
                <tr>
                    <td>${item.type || 'N/A'}</td>
                    <td>${item.name || 'N/A'}</td>
                    <td>${item.location || 'N/A'}</td>
                    <td title="${item.value || ''}">${(item.value || '').substring(0, 50)}${(item.value || '').length > 50 ? '...' : ''}</td>
                    <td>${suspiciousIcon}</td>
                </tr>
            `;
        }).join('');
        
        // Reinitialize Lucide icons
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
        
        this.addPaginationInfo('persistenceTable', persistence.length);
    }

    populateEventsTable() {
        const tableBody = document.getElementById('eventsTableBody');
        const eventLogs = this.currentScanData.artifacts?.event_logs || {};
        
        // Combine all event log categories into a single array
        const allEvents = [
            ...(eventLogs.application || []).map(event => ({ ...event, log_name: 'Application' })),
            ...(eventLogs.security || []).map(event => ({ ...event, log_name: 'Security' })),
            ...(eventLogs.system || []).map(event => ({ ...event, log_name: 'System' }))
        ];
        
        const start = (this.currentPage - 1) * this.itemsPerPage;
        const end = start + this.itemsPerPage;
        const pageData = allEvents.slice(start, end);
        
        tableBody.innerHTML = pageData.map(event => `
            <tr>
                <td>${event.log_name || 'N/A'}</td>
                <td>${event.event_id || 'N/A'}</td>
                <td>${event.level || 'N/A'}</td>
                <td>${event.source || 'N/A'}</td>
                <td>${event.timestamp || 'N/A'}</td>
                <td title="${event.message || ''}">${(event.message || '').substring(0, 100)}${(event.message || '').length > 100 ? '...' : ''}</td>
            </tr>
        `).join('');
        
        this.addPaginationInfo('eventsTable', allEvents.length);
    }

    addPaginationInfo(tableId, totalItems) {
        const table = document.getElementById(tableId);
        const container = table.closest('.table-container');
        
        // Remove existing pagination if present
        const existingPagination = container.querySelector('.pagination-info');
        if (existingPagination) {
            existingPagination.remove();
        }
        
        if (totalItems === 0) return;
        
        const totalPages = Math.ceil(totalItems / this.itemsPerPage);
        const start = (this.currentPage - 1) * this.itemsPerPage + 1;
        const end = Math.min(start + this.itemsPerPage - 1, totalItems);
        
        const paginationDiv = document.createElement('div');
        paginationDiv.className = 'pagination-info';
        paginationDiv.innerHTML = `
            <div class="pagination-controls">
                <span>Showing ${start}-${end} of ${totalItems} items</span>
                <div class="pagination-buttons">
                    <button class="btn btn-small" ${this.currentPage === 1 ? 'disabled' : ''} onclick="window.triageApp.changePage(${this.currentPage - 1})">Previous</button>
                    <span>Page ${this.currentPage} of ${totalPages}</span>
                    <button class="btn btn-small" ${this.currentPage === totalPages ? 'disabled' : ''} onclick="window.triageApp.changePage(${this.currentPage + 1})">Next</button>
                </div>
            </div>
        `;
        
        container.appendChild(paginationDiv);
    }

    changePage(newPage) {
        this.currentPage = newPage;
        this.updateCurrentTabData();
    }

    switchTab(tabName) {
        // Remove active class from all tabs and panels
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
        
        // Add active class to selected tab and panel
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
        document.getElementById(`${tabName}Panel`).classList.add('active');
        
        // Reset pagination for new tab
        this.currentPage = 1;
        this.updateCurrentTabData();
    }

    updateCurrentTabData() {
        // Re-render the current tab with pagination
        if (this.currentTab === 'processes') {
            this.populateProcessesTable();
        } else if (this.currentTab === 'network') {
            this.populateNetworkTable();
        } else if (this.currentTab === 'persistence') {
            this.populatePersistenceTable();
        } else if (this.currentTab === 'events') {
            this.populateEventsTable();
        } else if (this.currentTab === 'execution') {
            this.populateExecutionEvidence();
        }
    }

    validateScanData(data) {
        const errors = [];
        const warnings = [];
        
        // Check for required structure
        if (!data || typeof data !== 'object') {
            errors.push('Invalid data structure');
            return { valid: false, errors, warnings };
        }
        
        if (!data.scan_metadata) {
            warnings.push('Missing scan metadata');
        }
        
        if (!data.artifacts) {
            errors.push('Missing artifacts data');
            return { valid: false, errors, warnings };
        }
        
        // Validate timestamps (must be between 1970-2100)
        const minTimestamp = new Date('1970-01-01').getTime();
        const maxTimestamp = new Date('2100-01-01').getTime();
        
        // Check Shimcache entries
        const shimcache = data.artifacts.execution_evidence?.shimcache_entries || [];
        shimcache.forEach((entry, idx) => {
            if (entry.last_modified) {
                const timestamp = new Date(entry.last_modified).getTime();
                if (timestamp < minTimestamp || timestamp > maxTimestamp) {
                    warnings.push(`Shimcache entry ${idx}: Invalid timestamp ${entry.last_modified}`);
                }
            }
            
            if (entry.path && entry.path.includes('Invalid UTF')) {
                warnings.push(`Shimcache entry ${idx}: Invalid UTF encoding in path`);
            }
            
            if (entry.file_size && entry.file_size > 1099511627776) { // 1TB
                warnings.push(`Shimcache entry ${idx}: Suspiciously large file size ${entry.file_size}`);
            }
        });
        
        // Validate numeric ranges
        const processes = data.artifacts.running_processes || [];
        processes.forEach((proc, idx) => {
            if (proc.pid && (proc.pid < 0 || proc.pid > 100000)) {
                warnings.push(`Process ${idx}: Invalid PID ${proc.pid}`);
            }
        });
        
        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }

    showError(errorInfo) {
        const modal = document.getElementById('errorModal');
        document.getElementById('errorCategory').textContent = errorInfo.category || 'Error';
        document.getElementById('errorMessage').textContent = errorInfo.message || 'An unknown error occurred';
        document.getElementById('errorRemedy').textContent = 'Suggested action: ' + (errorInfo.remedy || 'Please try again');
        document.getElementById('errorTechnical').textContent = errorInfo.technical || 'No technical details available';
        
        this.lastError = errorInfo; // Store for copy function
        modal.classList.remove('hidden');
    }

    copyErrorDetails() {
        if (!this.lastError) return;
        
        const errorText = `
TriageIR Error Report
=====================
Category: ${this.lastError.category}
Message: ${this.lastError.message}
Remedy: ${this.lastError.remedy}

Technical Details:
${this.lastError.technical}

System: ${navigator.userAgent}
Timestamp: ${new Date().toISOString()}
        `.trim();
        
        navigator.clipboard.writeText(errorText).then(() => {
            alert('Error details copied to clipboard');
        }).catch(err => {
            console.error('Failed to copy error details:', err);
        });
    }

    setupAutosave() {
        // Autosave every 30 seconds if there's scan data
        setInterval(() => {
            if (this.currentScanData) {
                this.autosaveScanData();
            }
        }, 30000);
        
        // Save on window close
        window.addEventListener('beforeunload', (e) => {
            if (this.currentScanData) {
                this.autosaveScanData();
                e.preventDefault();
                e.returnValue = 'You have unsaved scan data. Are you sure you want to exit?';
            }
        });
    }

    autosaveScanData() {
        if (!this.currentScanData) return;
        
        try {
            const autosaveData = {
                timestamp: new Date().toISOString(),
                data: this.currentScanData
            };
            localStorage.setItem(this.AUTOSAVE_KEY, JSON.stringify(autosaveData));
            console.log('Scan data autosaved');
        } catch (error) {
            console.error('Failed to autosave:', error);
        }
    }

    checkAutosave() {
        try {
            const autosaveData = localStorage.getItem(this.AUTOSAVE_KEY);
            if (autosaveData) {
                const parsed = JSON.parse(autosaveData);
                const savedTime = new Date(parsed.timestamp);
                const now = new Date();
                const hoursSince = (now - savedTime) / (1000 * 60 * 60);
                
                if (hoursSince < 24) {
                    const restore = confirm(
                        `Found autosaved scan data from ${savedTime.toLocaleString()}.\n\n` +
                        `Do you want to restore this session?`
                    );
                    
                    if (restore) {
                        this.currentScanData = parsed.data;
                        this.showResultsScreen();
                    } else {
                        localStorage.removeItem(this.AUTOSAVE_KEY);
                    }
                }
            }
        } catch (error) {
            console.error('Failed to check autosave:', error);
        }
    }

    populateExecutionEvidence() {
        // Populate Prefetch table
        this.populatePrefetchTable();
        
        // Populate Shimcache table
        this.populateShimcacheTable();
    }

    populatePrefetchTable() {
        const tableBody = document.getElementById('prefetchTableBody');
        const prefetch = this.currentScanData?.artifacts?.execution_evidence?.prefetch_files || [];
        
        if (prefetch.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#999;">No prefetch files found</td></tr>';
            return;
        }
        
        const start = (this.currentPage - 1) * this.itemsPerPage;
        const end = start + this.itemsPerPage;
        const pageData = prefetch.slice(start, end);
        
        tableBody.innerHTML = pageData.map(file => `
            <tr>
                <td>${file.executable_name || 'N/A'}</td>
                <td>${file.run_count || 'N/A'}</td>
                <td>${file.last_run_time || 'N/A'}</td>
                <td title="${file.file_path || ''}">${(file.file_path || 'N/A').substring(0, 80)}${(file.file_path || '').length > 80 ? '...' : ''}</td>
            </tr>
        `).join('');
    }

    populateShimcacheTable() {
        const tableBody = document.getElementById('shimcacheTableBody');
        const shimcache = this.currentScanData?.artifacts?.execution_evidence?.shimcache_entries || [];
        
        if (shimcache.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#999;">No shimcache entries found</td></tr>';
            return;
        }
        
        const start = (this.currentPage - 1) * this.itemsPerPage;
        const end = start + this.itemsPerPage;
        const pageData = shimcache.slice(start, end);
        
        tableBody.innerHTML = pageData.map(entry => {
            const executionIcon = entry.execution_flag ? '✅ Yes' : '⚪ No';
            const fileSize = entry.file_size ? this.formatFileSize(entry.file_size) : 'N/A';
            
            return `
                <tr>
                    <td title="${entry.path || ''}">${(entry.path || 'N/A').substring(0, 60)}${(entry.path || '').length > 60 ? '...' : ''}</td>
                    <td>${this.formatTimestamp(entry.last_modified)}</td>
                    <td>${fileSize}</td>
                    <td>${executionIcon}</td>
                </tr>
            `;
        }).join('');
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        if (bytes > 1099511627776) return (bytes / 1099511627776).toFixed(2) + ' TB';
        if (bytes > 1073741824) return (bytes / 1073741824).toFixed(2) + ' GB';
        if (bytes > 1048576) return (bytes / 1048576).toFixed(2) + ' MB';
        if (bytes > 1024) return (bytes / 1024).toFixed(2) + ' KB';
        return bytes + ' Bytes';
    }

    formatTimestamp(timestamp) {
        if (!timestamp) return 'N/A';
        try {
            const date = new Date(timestamp);
            if (date.getFullYear() < 1970 || date.getFullYear() > 2100) {
                return '⚠️ Invalid';
            }
            return date.toLocaleString();
        } catch (e) {
            return '⚠️ Invalid';
        }
    }

    switchTab(tabName) {
        // Remove active class from all tabs and panels
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
        
        // Add active class to selected tab and panel
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
        document.getElementById(`${tabName}Panel`).classList.add('active');
    }

    updateFooterStatus(status) {
        document.getElementById('footerStatus').textContent = status;
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.triageApp = new TriageIRApp();
});