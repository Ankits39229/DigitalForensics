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
        
        // Sorting state
        this.sortState = {
            processes: { column: null, direction: null },
            network: { column: null, direction: null },
            persistence: { column: null, direction: null },
            events: { column: null, direction: null },
            prefetch: { column: null, direction: null },
            shimcache: { column: null, direction: null },
            fileactivity: { column: null, direction: null }
        };
        
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
            minimizeBtn.addEventListener('click', () => {
                console.log('Minimize button clicked');
                ipcRenderer.send('window-minimize');
            });
        }
        
        if (maximizeBtn) {
            maximizeBtn.addEventListener('click', () => {
                console.log('Maximize button clicked');
                ipcRenderer.send('window-maximize');
            });
        }
        
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                console.log('Close button clicked');
                ipcRenderer.send('window-close');
            });
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
        
        // Populate execution evidence (prefetch and shimcache)
        this.populateExecutionEvidence();
        
        // Setup search and export listeners
        this.setupSearchListeners();
        
        // Setup table sorting
        this.setupTableSorting();
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
        const warning = document.getElementById('processesWarning');
        let processes = this.currentScanData.artifacts?.running_processes || [];
        
        // Apply sorting if active
        const sortState = this.sortState.processes;
        if (sortState.column && sortState.direction) {
            const header = document.querySelector(`#processesTable th[data-sort="${sortState.column}"]`);
            const dataType = header ? header.getAttribute('data-type') : 'string';
            processes = this.sortData(processes, sortState.column, sortState.direction, dataType);
        }
        
        // Show warning if data is truncated
        if (processes.length > this.itemsPerPage) {
            warning.innerHTML = `<i data-lucide="alert-circle" style="width: 16px; height: 16px;"></i> Displaying first ${this.itemsPerPage} of ${processes.length} processes. Use search to filter or export to CSV for complete data.`;
            warning.classList.remove('hidden');
        } else {
            warning.classList.add('hidden');
        }
        
        const start = (this.currentPage - 1) * this.itemsPerPage;
        const end = start + this.itemsPerPage;
        const pageData = processes.slice(start, end);
        
        tableBody.innerHTML = pageData.map((proc, index) => `
            <tr data-index="${start + index}">
                <td>${proc.pid || 'N/A'}</td>
                <td>${proc.name || 'N/A'}</td>
                <td>${proc.user || 'N/A'}</td>
                <td>${proc.memory_usage_mb ? proc.memory_usage_mb.toFixed(1) : 'N/A'}</td>
                <td title="${proc.command_line || ''}">${(proc.command_line || '').substring(0, 50)}${(proc.command_line || '').length > 50 ? '...' : ''}</td>
            </tr>
        `).join('');
        
        // Reinitialize Lucide icons
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
        
        this.addPaginationInfo('processesTable', processes.length);
    }

    populateNetworkTable() {
        const tableBody = document.getElementById('networkTableBody');
        const warning = document.getElementById('networkWarning');
        let connections = this.currentScanData.artifacts?.network_connections || [];
        
        // Apply sorting if active
        const sortState = this.sortState.network;
        if (sortState.column && sortState.direction) {
            const header = document.querySelector(`#networkTable th[data-sort="${sortState.column}"]`);
            const dataType = header ? header.getAttribute('data-type') : 'string';
            connections = this.sortData(connections, sortState.column, sortState.direction, dataType);
        }
        
        // Show warning if data is truncated
        if (connections.length > this.itemsPerPage) {
            warning.innerHTML = `<i data-lucide="alert-circle" style="width: 16px; height: 16px;"></i> Displaying first ${this.itemsPerPage} of ${connections.length} connections. Use search to filter or export to CSV for complete data.`;
            warning.classList.remove('hidden');
        } else {
            warning.classList.add('hidden');
        }
        
        const start = (this.currentPage - 1) * this.itemsPerPage;
        const end = start + this.itemsPerPage;
        const pageData = connections.slice(start, end);
        
        tableBody.innerHTML = pageData.map((conn, index) => `
            <tr data-index="${start + index}">
                <td>${conn.protocol || 'N/A'}</td>
                <td>${conn.local_address || 'N/A'}</td>
                <td>${conn.local_port || 'N/A'}</td>
                <td>${conn.remote_address || 'N/A'}</td>
                <td>${conn.remote_port || 'N/A'}</td>
                <td>${conn.state || 'N/A'}</td>
                <td>${conn.pid || conn.process_name || 'N/A'}</td>
            </tr>
        `).join('');
        
        // Reinitialize Lucide icons
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
        
        this.addPaginationInfo('networkTable', connections.length);
    }

    populatePersistenceTable() {
        const tableBody = document.getElementById('persistenceTableBody');
        const warning = document.getElementById('persistenceWarning');
        let persistence = this.currentScanData.artifacts?.persistence_mechanisms || [];
        
        // Apply sorting if active
        const sortState = this.sortState.persistence;
        if (sortState.column && sortState.direction) {
            const header = document.querySelector(`#persistenceTable th[data-sort="${sortState.column}"]`);
            const dataType = header ? header.getAttribute('data-type') : 'string';
            persistence = this.sortData(persistence, sortState.column, sortState.direction, dataType);
        }
        
        // Show warning if data is truncated
        if (persistence.length > this.itemsPerPage) {
            warning.innerHTML = `<i data-lucide="alert-circle" style="width: 16px; height: 16px;"></i> Displaying first ${this.itemsPerPage} of ${persistence.length} items. Use search to filter or export to CSV for complete data.`;
            warning.classList.remove('hidden');
        } else {
            warning.classList.add('hidden');
        }
        
        const start = (this.currentPage - 1) * this.itemsPerPage;
        const end = start + this.itemsPerPage;
        const pageData = persistence.slice(start, end);
        
        tableBody.innerHTML = pageData.map((item, index) => {
            const suspiciousIcon = item.is_suspicious 
                ? '<i data-lucide="alert-triangle" style="width: 14px; height: 14px; color: #F7630C;"></i> Yes' 
                : '<i data-lucide="check" style="width: 14px; height: 14px; color: #107C10;"></i> No';
            return `
                <tr data-index="${start + index}">
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
        // Reinitialize Lucide icons
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
        
        this.addPaginationInfo('persistenceTable', persistence.length);
    }

    populateEventsTable() {
        const tableBody = document.getElementById('eventsTableBody');
        const warning = document.getElementById('eventsWarning');
        const eventLogs = this.currentScanData.artifacts?.event_logs || {};
        
        // Combine all event log categories into a single array
        let allEvents = [
            ...(eventLogs.application || []).map(event => ({ ...event, log_name: 'Application' })),
            ...(eventLogs.security || []).map(event => ({ ...event, log_name: 'Security' })),
            ...(eventLogs.system || []).map(event => ({ ...event, log_name: 'System' }))
        ];
        
        // Apply sorting if active
        const sortState = this.sortState.events;
        if (sortState.column && sortState.direction) {
            const header = document.querySelector(`#eventsTable th[data-sort="${sortState.column}"]`);
            const dataType = header ? header.getAttribute('data-type') : 'string';
            allEvents = this.sortData(allEvents, sortState.column, sortState.direction, dataType);
        }
        
        // Show warning if data is truncated
        if (allEvents.length > this.itemsPerPage) {
            warning.innerHTML = `<i data-lucide="alert-circle" style="width: 16px; height: 16px;"></i> Displaying first ${this.itemsPerPage} of ${allEvents.length} events. Use search to filter or export to CSV for complete data.`;
            warning.classList.remove('hidden');
        } else {
            warning.classList.add('hidden');
        }
        
        const start = (this.currentPage - 1) * this.itemsPerPage;
        const end = start + this.itemsPerPage;
        const pageData = allEvents.slice(start, end);
        
        tableBody.innerHTML = pageData.map((event, index) => `
            <tr data-index="${start + index}">
                <td>${event.log_name || 'N/A'}</td>
                <td>${event.event_id || 'N/A'}</td>
                <td>${event.level || 'N/A'}</td>
                <td>${event.source || 'N/A'}</td>
                <td>${event.timestamp || 'N/A'}</td>
                <td title="${event.message || ''}">${(event.message || '').substring(0, 100)}${(event.message || '').length > 100 ? '...' : ''}</td>
            </tr>
        `).join('');
        
        // Reinitialize Lucide icons
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
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

    // Search and Filter Functionality
    setupSearchListeners() {
        const processSearch = document.getElementById('processSearch');
        const networkSearch = document.getElementById('networkSearch');
        const persistenceSearch = document.getElementById('persistenceSearch');
        const eventsSearch = document.getElementById('eventsSearch');

        if (processSearch) {
            processSearch.addEventListener('input', this.debounce((e) => {
                this.filterProcesses(e.target.value);
            }, 300));
        }

        if (networkSearch) {
            networkSearch.addEventListener('input', this.debounce((e) => {
                this.filterNetwork(e.target.value);
            }, 300));
        }

        if (persistenceSearch) {
            persistenceSearch.addEventListener('input', this.debounce((e) => {
                this.filterPersistence(e.target.value);
            }, 300));
        }

        if (eventsSearch) {
            eventsSearch.addEventListener('input', this.debounce((e) => {
                this.filterEvents(e.target.value);
            }, 300));
        }

        // Export button listeners
        const exportProcessesBtn = document.getElementById('exportProcessesBtn');
        const exportNetworkBtn = document.getElementById('exportNetworkBtn');
        const exportPersistenceBtn = document.getElementById('exportPersistenceBtn');
        const exportEventsBtn = document.getElementById('exportEventsBtn');

        if (exportProcessesBtn) {
            exportProcessesBtn.addEventListener('click', () => this.exportProcessesToCSV());
        }

        if (exportNetworkBtn) {
            exportNetworkBtn.addEventListener('click', () => this.exportNetworkToCSV());
        }

        if (exportPersistenceBtn) {
            exportPersistenceBtn.addEventListener('click', () => this.exportPersistenceToCSV());
        }

        if (exportEventsBtn) {
            exportEventsBtn.addEventListener('click', () => this.exportEventsToCSV());
        }

        // Execution evidence export buttons
        const exportPrefetchBtn = document.getElementById('exportPrefetchBtn');
        const exportShimcacheBtn = document.getElementById('exportShimcacheBtn');

        if (exportPrefetchBtn) {
            exportPrefetchBtn.addEventListener('click', () => this.exportPrefetchToCSV());
        }

        if (exportShimcacheBtn) {
            exportShimcacheBtn.addEventListener('click', () => this.exportShimcacheToCSV());
        }

        // Execution evidence search inputs
        const prefetchSearch = document.getElementById('prefetchSearch');
        const shimcacheSearch = document.getElementById('shimcacheSearch');
        const fileActivitySearch = document.getElementById('fileActivitySearch');

        if (prefetchSearch) {
            prefetchSearch.addEventListener('input', this.debounce((e) => {
                this.filterPrefetch(e.target.value);
            }, 300));
        }

        if (shimcacheSearch) {
            shimcacheSearch.addEventListener('input', this.debounce((e) => {
                this.filterShimcache(e.target.value);
            }, 300));
        }

        if (fileActivitySearch) {
            fileActivitySearch.addEventListener('input', this.debounce((e) => {
                this.filterFileActivity(e.target.value);
            }, 300));
        }
        
        // Export buttons
        const exportFileActivityBtn = document.getElementById('exportFileActivityBtn');
        if (exportFileActivityBtn) {
            exportFileActivityBtn.addEventListener('click', () => {
                this.exportFileActivityToCSV();
            });
        }
    }

    setupTableSorting() {
        // Set up sorting for all tables
        const tables = ['processesTable', 'networkTable', 'persistenceTable', 'eventsTable', 'prefetchTable', 'shimcacheTable', 'fileActivityTable'];
        
        tables.forEach(tableId => {
            const table = document.getElementById(tableId);
            if (!table) return;
            
            const headers = table.querySelectorAll('thead th.sortable');
            headers.forEach(header => {
                header.addEventListener('click', (e) => {
                    const sortColumn = header.getAttribute('data-sort');
                    const sortType = header.getAttribute('data-type');
                    const tableType = this.getTableType(tableId);
                    
                    this.sortTable(tableType, sortColumn, sortType);
                });
            });
        });
        
        // Set up expandable rows
        this.setupExpandableRows();
        
        // Set up context menu
        this.setupContextMenu();
    }
    
    setupExpandableRows() {
        const tables = ['processesTable', 'networkTable', 'persistenceTable', 'eventsTable', 'prefetchTable', 'shimcacheTable'];
        
        tables.forEach(tableId => {
            const table = document.getElementById(tableId);
            if (!table) return;
            
            const tbody = table.querySelector('tbody');
            if (!tbody) return;
            
            tbody.addEventListener('click', (e) => {
                // Find the clicked row (skip if clicking detail row or copyable element)
                const row = e.target.closest('tr');
                if (!row || row.classList.contains('detail-row') || e.target.closest('.copyable')) {
                    return;
                }
                
                const tableType = this.getTableType(tableId);
                this.toggleRowExpansion(row, tableType);
            });
        });
    }
    
    toggleRowExpansion(row, tableType) {
        const isExpanded = row.classList.contains('expanded');
        
        if (isExpanded) {
            // Collapse the row
            row.classList.remove('expanded');
            const detailRow = row.nextElementSibling;
            if (detailRow && detailRow.classList.contains('detail-row')) {
                detailRow.remove();
            }
        } else {
            // Expand the row
            row.classList.add('expanded');
            
            // Get row data
            const rowIndex = parseInt(row.getAttribute('data-index'));
            let rowData = null;
            
            switch(tableType) {
                case 'processes':
                    rowData = this.currentScanData?.artifacts?.running_processes?.[rowIndex];
                    break;
                case 'network':
                    rowData = this.currentScanData?.artifacts?.network_connections?.[rowIndex];
                    break;
                case 'persistence':
                    rowData = this.currentScanData?.artifacts?.persistence_mechanisms?.[rowIndex];
                    break;
                case 'events':
                    // Events are combined from multiple sources, need to recalculate
                    const eventLogs = this.currentScanData?.artifacts?.event_logs || {};
                    const allEvents = [
                        ...(eventLogs.application || []).map(event => ({ ...event, log_name: 'Application' })),
                        ...(eventLogs.security || []).map(event => ({ ...event, log_name: 'Security' })),
                        ...(eventLogs.system || []).map(event => ({ ...event, log_name: 'System' }))
                    ];
                    // Apply sorting if active
                    const eventSortState = this.sortState.events;
                    if (eventSortState.column && eventSortState.direction) {
                        const header = document.querySelector(`#eventsTable th[data-sort="${eventSortState.column}"]`);
                        const dataType = header ? header.getAttribute('data-type') : 'string';
                        const sortedEvents = this.sortData(allEvents, eventSortState.column, eventSortState.direction, dataType);
                        rowData = sortedEvents[rowIndex];
                    } else {
                        rowData = allEvents[rowIndex];
                    }
                    break;
                case 'prefetch':
                    rowData = this.currentScanData?.artifacts?.execution_evidence?.prefetch_files?.[rowIndex];
                    break;
                case 'shimcache':
                    // Shimcache needs filtered data
                    const shimcache = this.currentScanData?.artifacts?.execution_evidence?.shimcache_entries || [];
                    let validShimcache = shimcache.filter(entry => {
                        if (!entry.path || entry.path.trim() === '' || entry.path === 'Invalid UTF-16') return false;
                        if (entry.file_size && entry.file_size > 1099511627776) return false;
                        if (entry.last_modified && entry.last_modified.includes('+') && parseInt(entry.last_modified.substring(1, 6)) > 3000) return false;
                        return true;
                    });
                    // Apply sorting if active
                    const shimSortState = this.sortState.shimcache;
                    if (shimSortState.column && shimSortState.direction) {
                        const header = document.querySelector(`#shimcacheTable th[data-sort="${shimSortState.column}"]`);
                        const dataType = header ? header.getAttribute('data-type') : 'string';
                        validShimcache = this.sortData(validShimcache, shimSortState.column, shimSortState.direction, dataType);
                    }
                    rowData = validShimcache[rowIndex];
                    break;
                case 'fileactivity':
                    const fileActivity = this.currentScanData?.artifacts?.file_activity;
                    if (fileActivity && fileActivity.activities) {
                        let activities = [...fileActivity.activities];
                        // Apply sorting if active
                        const activitySortState = this.sortState.fileactivity;
                        if (activitySortState && activitySortState.column && activitySortState.direction) {
                            const header = document.querySelector(`#fileActivityTable th[data-sort="${activitySortState.column}"]`);
                            const dataType = header ? header.getAttribute('data-type') : 'string';
                            activities = this.sortData(activities, activitySortState.column, activitySortState.direction, dataType);
                        }
                        rowData = activities[rowIndex];
                    }
                    break;
            }
            
            if (rowData) {
                const detailRow = this.buildDetailRow(rowData, tableType, row.cells.length);
                row.insertAdjacentHTML('afterend', detailRow);
                
                // Add copy listeners to copyable fields in detail row
                const nextRow = row.nextElementSibling;
                if (nextRow) {
                    nextRow.querySelectorAll('.copyable').forEach(el => {
                        el.addEventListener('click', (e) => {
                            e.stopPropagation();
                            this.copyToClipboard(el.textContent, el);
                        });
                    });
                }
                
                // Reinitialize Lucide icons
                if (typeof lucide !== 'undefined') {
                    lucide.createIcons();
                }
            }
        }
    }
    
    buildDetailRow(data, tableType, colSpan) {
        let detailHTML = `<tr class="detail-row"><td colspan="${colSpan}"><div class="detail-content">`;
        
        switch(tableType) {
            case 'processes':
                detailHTML += this.buildProcessDetails(data);
                break;
            case 'network':
                detailHTML += this.buildNetworkDetails(data);
                break;
            case 'persistence':
                detailHTML += this.buildPersistenceDetails(data);
                break;
            case 'events':
                detailHTML += this.buildEventDetails(data);
                break;
            case 'prefetch':
                detailHTML += this.buildPrefetchDetails(data);
                break;
            case 'shimcache':
                detailHTML += this.buildShimcacheDetails(data);
                break;
            case 'fileactivity':
                detailHTML += this.buildFileActivityDetails(data);
                break;
        }
        
        detailHTML += `</div></td></tr>`;
        return detailHTML;
    }
    
    buildProcessDetails(proc) {
        const escapeHtml = (text) => {
            const div = document.createElement('div');
            div.textContent = text || '';
            return div.innerHTML;
        };
        
        return `
            <div class="detail-section">
                <h4>Process Information</h4>
                <div class="detail-field">
                    <span class="detail-label">Full Command Line:</span>
                    <span class="detail-value copyable">${escapeHtml(proc.command_line)}</span>
                </div>
                <div class="detail-field">
                    <span class="detail-label">Executable Path:</span>
                    <span class="detail-value copyable">${escapeHtml(proc.path)}</span>
                </div>
                <div class="detail-field">
                    <span class="detail-label">Process ID:</span>
                    <span class="detail-value copyable">${proc.pid}</span>
                </div>
                <div class="detail-field">
                    <span class="detail-label">Parent PID:</span>
                    <span class="detail-value copyable">${proc.parent_pid || 'N/A'}</span>
                </div>
            </div>
            ${proc.hashes ? `
            <div class="detail-section">
                <h4>Hashes</h4>
                <div class="detail-field">
                    <span class="detail-label">MD5:</span>
                    <span class="detail-value copyable">${escapeHtml(proc.hashes.md5 || 'N/A')}</span>
                </div>
                <div class="detail-field">
                    <span class="detail-label">SHA1:</span>
                    <span class="detail-value copyable">${escapeHtml(proc.hashes.sha1 || 'N/A')}</span>
                </div>
                <div class="detail-field">
                    <span class="detail-label">SHA256:</span>
                    <span class="detail-value copyable">${escapeHtml(proc.hashes.sha256 || 'N/A')}</span>
                </div>
            </div>
            ` : ''}
            ${proc.memory ? `
            <div class="detail-section">
                <h4>Memory Usage</h4>
                <div class="detail-field">
                    <span class="detail-label">Working Set:</span>
                    <span class="detail-value">${this.formatBytes(proc.memory.working_set)}</span>
                </div>
                <div class="detail-field">
                    <span class="detail-label">Private Memory:</span>
                    <span class="detail-value">${this.formatBytes(proc.memory.private_memory)}</span>
                </div>
            </div>
            ` : ''}
        `;
    }
    
    buildNetworkDetails(conn) {
        const escapeHtml = (text) => {
            const div = document.createElement('div');
            div.textContent = text || '';
            return div.innerHTML;
        };
        
        return `
            <div class="detail-section">
                <h4>Connection Information</h4>
                <div class="detail-field">
                    <span class="detail-label">Local Address:</span>
                    <span class="detail-value copyable">${escapeHtml(conn.local_address)}:${conn.local_port}</span>
                </div>
                <div class="detail-field">
                    <span class="detail-label">Remote Address:</span>
                    <span class="detail-value copyable">${escapeHtml(conn.remote_address)}:${conn.remote_port}</span>
                </div>
                <div class="detail-field">
                    <span class="detail-label">Protocol:</span>
                    <span class="detail-value">${conn.protocol}</span>
                </div>
                <div class="detail-field">
                    <span class="detail-label">State:</span>
                    <span class="detail-value">${conn.state}</span>
                </div>
            </div>
            <div class="detail-section">
                <h4>Process Information</h4>
                <div class="detail-field">
                    <span class="detail-label">Process ID:</span>
                    <span class="detail-value copyable">${conn.pid}</span>
                </div>
                <div class="detail-field">
                    <span class="detail-label">Process Name:</span>
                    <span class="detail-value copyable">${escapeHtml(conn.process_name || 'N/A')}</span>
                </div>
            </div>
        `;
    }
    
    buildPersistenceDetails(item) {
        const escapeHtml = (text) => {
            const div = document.createElement('div');
            div.textContent = text || '';
            return div.innerHTML;
        };
        
        return `
            <div class="detail-section">
                <h4>Persistence Mechanism</h4>
                <div class="detail-field">
                    <span class="detail-label">Full Location:</span>
                    <span class="detail-value copyable">${escapeHtml(item.location)}</span>
                </div>
                <div class="detail-field">
                    <span class="detail-label">Complete Value:</span>
                    <span class="detail-value copyable">${escapeHtml(item.value)}</span>
                </div>
                <div class="detail-field">
                    <span class="detail-label">Entry Name:</span>
                    <span class="detail-value copyable">${escapeHtml(item.name)}</span>
                </div>
                <div class="detail-field">
                    <span class="detail-label">Category:</span>
                    <span class="detail-value">${escapeHtml(item.category)}</span>
                </div>
                ${item.suspicious ? `
                <div class="detail-field">
                    <span class="detail-label">Suspicious Indicators:</span>
                    <span class="detail-value" style="color: var(--color-status-danger);">
                        <i data-lucide="alert-triangle" style="width: 14px; height: 14px;"></i>
                        Flagged as suspicious
                    </span>
                </div>
                ` : ''}
            </div>
        `;
    }
    
    buildEventDetails(event) {
        const escapeHtml = (text) => {
            const div = document.createElement('div');
            div.textContent = text || '';
            return div.innerHTML;
        };
        
        return `
            <div class="detail-section">
                <h4>Event Information</h4>
                <div class="detail-field">
                    <span class="detail-label">Event ID:</span>
                    <span class="detail-value copyable">${event.event_id}</span>
                </div>
                <div class="detail-field">
                    <span class="detail-label">Source:</span>
                    <span class="detail-value">${escapeHtml(event.source)}</span>
                </div>
                <div class="detail-field">
                    <span class="detail-label">Timestamp:</span>
                    <span class="detail-value copyable">${escapeHtml(event.timestamp)}</span>
                </div>
                <div class="detail-field">
                    <span class="detail-label">Level:</span>
                    <span class="detail-value">${escapeHtml(event.level)}</span>
                </div>
            </div>
            <div class="detail-section">
                <h4>Message</h4>
                <div class="detail-field">
                    <span class="detail-value copyable" style="grid-column: 1 / -1; white-space: pre-wrap; word-break: break-word;">${escapeHtml(event.message)}</span>
                </div>
            </div>
        `;
    }
    
    buildPrefetchDetails(entry) {
        const escapeHtml = (text) => {
            const div = document.createElement('div');
            div.textContent = text || '';
            return div.innerHTML;
        };
        
        return `
            <div class="detail-section">
                <h4>Prefetch Information</h4>
                <div class="detail-field">
                    <span class="detail-label">Full Path:</span>
                    <span class="detail-value copyable">${escapeHtml(entry.file_path)}</span>
                </div>
                <div class="detail-field">
                    <span class="detail-label">Executable Name:</span>
                    <span class="detail-value copyable">${escapeHtml(entry.executable_name)}</span>
                </div>
                <div class="detail-field">
                    <span class="detail-label">Run Count:</span>
                    <span class="detail-value">${entry.run_count || 'N/A'}</span>
                </div>
                <div class="detail-field">
                    <span class="detail-label">Last Run Time:</span>
                    <span class="detail-value copyable">${escapeHtml(entry.last_run_time || 'N/A')}</span>
                </div>
            </div>
            ${entry.referenced_files && entry.referenced_files.length > 0 ? `
            <div class="detail-section">
                <h4>Referenced Files (${entry.referenced_files.length})</h4>
                <div class="detail-field" style="grid-column: 1 / -1;">
                    <ul style="margin: 0; padding-left: 20px; max-height: 200px; overflow-y: auto;">
                        ${entry.referenced_files.slice(0, 20).map(file => `<li class="copyable" style="margin: 4px 0;">${escapeHtml(file)}</li>`).join('')}
                        ${entry.referenced_files.length > 20 ? `<li style="color: var(--color-text-secondary); font-style: italic;">... and ${entry.referenced_files.length - 20} more files</li>` : ''}
                    </ul>
                </div>
            </div>
            ` : ''}
        `;
    }
    
    buildShimcacheDetails(entry) {
        const escapeHtml = (text) => {
            const div = document.createElement('div');
            div.textContent = text || '';
            return div.innerHTML;
        };
        
        return `
            <div class="detail-section">
                <h4>Shimcache Entry</h4>
                <div class="detail-field">
                    <span class="detail-label">Full Path:</span>
                    <span class="detail-value copyable">${escapeHtml(entry.path)}</span>
                </div>
                <div class="detail-field">
                    <span class="detail-label">Last Modified:</span>
                    <span class="detail-value copyable">${escapeHtml(entry.last_modified || 'N/A')}</span>
                </div>
                <div class="detail-field">
                    <span class="detail-label">File Size:</span>
                    <span class="detail-value">${entry.file_size ? this.formatBytes(entry.file_size) : 'N/A'}</span>
                </div>
                <div class="detail-field">
                    <span class="detail-label">Execution Flag:</span>
                    <span class="detail-value">${entry.execution_flag !== undefined ? (entry.execution_flag ? 'Yes' : 'No') : 'N/A'}</span>
                </div>
            </div>
        `;
    }
    
    setupContextMenu() {
        const contextMenu = document.getElementById('contextMenu');
        if (!contextMenu) return;
        
        let currentTarget = null;
        
        // Add context menu to all table rows
        const tables = ['processesTable', 'networkTable', 'persistenceTable', 'eventsTable', 'prefetchTable', 'shimcacheTable'];
        
        tables.forEach(tableId => {
            const table = document.getElementById(tableId);
            if (!table) return;
            
            const tbody = table.querySelector('tbody');
            if (!tbody) return;
            
            tbody.addEventListener('contextmenu', (e) => {
                const row = e.target.closest('tr:not(.detail-row)');
                if (!row) return;
                
                e.preventDefault();
                currentTarget = e.target;
                
                // Position context menu
                contextMenu.style.left = `${e.pageX}px`;
                contextMenu.style.top = `${e.pageY}px`;
                contextMenu.classList.add('active');
            });
        });
        
        // Also add context menu to copyable fields in detail rows
        document.addEventListener('contextmenu', (e) => {
            if (e.target.closest('.copyable')) {
                e.preventDefault();
                currentTarget = e.target;
                
                contextMenu.style.left = `${e.pageX}px`;
                contextMenu.style.top = `${e.pageY}px`;
                contextMenu.classList.add('active');
            }
        });
        
        // Handle context menu clicks
        contextMenu.addEventListener('click', (e) => {
            const item = e.target.closest('.context-menu-item');
            if (!item) return;
            
            const action = item.getAttribute('data-action');
            
            switch(action) {
                case 'copy-value':
                    if (currentTarget) {
                        const value = currentTarget.textContent.trim();
                        this.copyToClipboard(value, currentTarget);
                    }
                    break;
                    
                case 'copy-row':
                    if (currentTarget) {
                        const row = currentTarget.closest('tr');
                        if (row) {
                            const cells = Array.from(row.cells).map(cell => cell.textContent.trim());
                            this.copyToClipboard(cells.join(' | '), currentTarget);
                        }
                    }
                    break;
                    
                case 'search-online':
                    if (currentTarget) {
                        const value = currentTarget.textContent.trim();
                        require('electron').shell.openExternal(`https://www.google.com/search?q=${encodeURIComponent(value)}`);
                    }
                    break;
                    
                case 'virustotal':
                    if (currentTarget) {
                        const value = currentTarget.textContent.trim();
                        // Check if it looks like a hash (32, 40, or 64 hex characters)
                        if (/^[a-fA-F0-9]{32,64}$/.test(value)) {
                            require('electron').shell.openExternal(`https://www.virustotal.com/gui/search/${value}`);
                        } else {
                            require('electron').shell.openExternal(`https://www.virustotal.com/gui/search/${encodeURIComponent(value)}`);
                        }
                    }
                    break;
            }
            
            contextMenu.classList.remove('active');
        });
        
        // Close context menu when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.context-menu')) {
                contextMenu.classList.remove('active');
            }
        });
    }
    
    copyToClipboard(text, element) {
        if (!text) return;
        
        navigator.clipboard.writeText(text).then(() => {
            // Add visual feedback
            if (element) {
                element.classList.add('copied');
                setTimeout(() => {
                    element.classList.remove('copied');
                }, 2000);
            }
            
            console.log('Copied to clipboard:', text.substring(0, 50) + (text.length > 50 ? '...' : ''));
        }).catch(err => {
            console.error('Failed to copy:', err);
        });
    }


    getTableType(tableId) {
        const mapping = {
            'processesTable': 'processes',
            'networkTable': 'network',
            'persistenceTable': 'persistence',
            'eventsTable': 'events',
            'prefetchTable': 'prefetch',
            'shimcacheTable': 'shimcache',
            'fileActivityTable': 'fileactivity'
        };
        return mapping[tableId] || 'processes';
    }

    sortTable(tableType, column, dataType) {
        const currentSort = this.sortState[tableType];
        
        // Toggle sort direction
        if (currentSort.column === column) {
            if (currentSort.direction === 'asc') {
                currentSort.direction = 'desc';
            } else if (currentSort.direction === 'desc') {
                currentSort.direction = null;
                currentSort.column = null;
            } else {
                currentSort.direction = 'asc';
            }
        } else {
            currentSort.column = column;
            currentSort.direction = 'asc';
        }
        
        // Update UI to show sort indicators
        this.updateSortIndicators(tableType);
        
        // Re-render the table with sorted data
        this.updateTableWithSort(tableType);
    }

    updateSortIndicators(tableType) {
        const tableIds = {
            'processes': 'processesTable',
            'network': 'networkTable',
            'persistence': 'persistenceTable',
            'events': 'eventsTable',
            'prefetch': 'prefetchTable',
            'shimcache': 'shimcacheTable'
        };
        
        const tableId = tableIds[tableType];
        const table = document.getElementById(tableId);
        if (!table) return;
        
        const headers = table.querySelectorAll('thead th.sortable');
        const currentSort = this.sortState[tableType];
        
        headers.forEach(header => {
            const column = header.getAttribute('data-sort');
            header.classList.remove('sorted-asc', 'sorted-desc');
            
            if (column === currentSort.column) {
                if (currentSort.direction === 'asc') {
                    header.classList.add('sorted-asc');
                } else if (currentSort.direction === 'desc') {
                    header.classList.add('sorted-desc');
                }
            }
        });
    }

    sortData(data, column, direction, dataType) {
        if (!direction || !column) return data;
        
        return [...data].sort((a, b) => {
            let aVal = a[column];
            let bVal = b[column];
            
            // Handle null/undefined
            if (aVal === null || aVal === undefined) aVal = '';
            if (bVal === null || bVal === undefined) bVal = '';
            
            let comparison = 0;
            
            if (dataType === 'number') {
                const aNum = parseFloat(aVal) || 0;
                const bNum = parseFloat(bVal) || 0;
                comparison = aNum - bNum;
            } else if (dataType === 'boolean') {
                const aBool = aVal ? 1 : 0;
                const bBool = bVal ? 1 : 0;
                comparison = aBool - bBool;
            } else {
                // String comparison
                comparison = String(aVal).toLowerCase().localeCompare(String(bVal).toLowerCase());
            }
            
            return direction === 'asc' ? comparison : -comparison;
        });
    }

    updateTableWithSort(tableType) {
        // Trigger re-render of the appropriate table
        switch(tableType) {
            case 'processes':
                this.populateProcessesTable();
                break;
            case 'network':
                this.populateNetworkTable();
                break;
            case 'persistence':
                this.populatePersistenceTable();
                break;
            case 'events':
                this.populateEventsTable();
                break;
            case 'prefetch':
                this.populatePrefetchTable();
                break;
            case 'shimcache':
                this.populateShimcacheTable();
                break;
            case 'fileactivity':
                this.populateFileActivityTable();
                break;
        }
    }

    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    filterProcesses(searchTerm) {
        if (!this.currentScanData || !this.currentScanData.artifacts) return;
        
        const processes = this.currentScanData.artifacts.running_processes || [];
        const filtered = this.filterArray(processes, searchTerm, ['name', 'user', 'pid', 'command_line']);
        
        this.displayFilteredProcesses(filtered, processes.length, searchTerm);
    }

    filterNetwork(searchTerm) {
        if (!this.currentScanData || !this.currentScanData.artifacts) return;
        
        const connections = this.currentScanData.artifacts.network_connections || [];
        const filtered = this.filterArray(connections, searchTerm, ['protocol', 'local_address', 'remote_address', 'state', 'process_name']);
        
        this.displayFilteredNetwork(filtered, connections.length, searchTerm);
    }

    filterPersistence(searchTerm) {
        if (!this.currentScanData || !this.currentScanData.artifacts) return;
        
        const items = this.currentScanData.artifacts.persistence_mechanisms || [];
        const filtered = this.filterArray(items, searchTerm, ['type', 'name', 'value', 'location']);
        
        this.displayFilteredPersistence(filtered, items.length, searchTerm);
    }

    filterEvents(searchTerm) {
        if (!this.currentScanData || !this.currentScanData.artifacts) return;
        
        const eventLogs = this.currentScanData.artifacts.event_logs || {};
        
        // Combine all event log categories into a single array
        const allEvents = [
            ...(eventLogs.application || []).map(event => ({ ...event, log_name: 'Application' })),
            ...(eventLogs.security || []).map(event => ({ ...event, log_name: 'Security' })),
            ...(eventLogs.system || []).map(event => ({ ...event, log_name: 'System' }))
        ];
        
        const filtered = this.filterArray(allEvents, searchTerm, ['event_id', 'level', 'source', 'message', 'log_name']);
        
        this.displayFilteredEvents(filtered, allEvents.length, searchTerm);
    }

    filterPrefetch(searchTerm) {
        if (!this.currentScanData || !this.currentScanData.artifacts) return;
        
        const prefetch = this.currentScanData.artifacts.execution_evidence?.prefetch_files || [];
        const filtered = this.filterArray(prefetch, searchTerm, ['executable_name', 'file_path']);
        
        this.displayFilteredPrefetch(filtered, prefetch.length, searchTerm);
    }

    filterShimcache(searchTerm) {
        if (!this.currentScanData || !this.currentScanData.artifacts) return;
        
        const shimcache = this.currentScanData.artifacts.execution_evidence?.shimcache_entries || [];
        
        // Filter out corrupt entries first
        const validShimcache = shimcache.filter(entry => {
            if (!entry.path || entry.path.trim() === '' || entry.path === 'Invalid UTF-16') return false;
            if (entry.file_size && entry.file_size > 1099511627776) return false;
            if (entry.last_modified && entry.last_modified.includes('+') && parseInt(entry.last_modified.substring(1, 6)) > 3000) return false;
            return true;
        });
        
        const filtered = this.filterArray(validShimcache, searchTerm, ['path']);
        
        this.displayFilteredShimcache(filtered, validShimcache.length, searchTerm, shimcache.length);
    }

    filterArray(array, searchTerm, fields) {
        if (!searchTerm || searchTerm.trim() === '') {
            return array;
        }
        
        const term = searchTerm.toLowerCase();
        return array.filter(item => {
            return fields.some(field => {
                const value = item[field];
                if (value === null || value === undefined) return false;
                return String(value).toLowerCase().includes(term);
            });
        });
    }

    displayFilteredProcesses(filtered, total, searchTerm) {
        const tableBody = document.getElementById('processesTableBody');
        const warning = document.getElementById('processesWarning');
        
        // Show warning if data is truncated
        if (filtered.length > this.itemsPerPage) {
            warning.innerHTML = `<i data-lucide="alert-circle" style="width: 16px; height: 16px;"></i> Displaying ${this.itemsPerPage} of ${filtered.length} ${searchTerm ? 'matching' : ''} processes. ${total > filtered.length ? `(${total} total)` : ''} Use search to filter or export to CSV for complete data.`;
            warning.classList.remove('hidden');
        } else if (searchTerm && filtered.length < total) {
            warning.innerHTML = `<i data-lucide="alert-circle" style="width: 16px; height: 16px;"></i> Showing ${filtered.length} of ${total} processes matching "${searchTerm}".`;
            warning.classList.remove('hidden');
        } else {
            warning.classList.add('hidden');
        }
        
        const displayData = filtered.slice(0, this.itemsPerPage);
        
        tableBody.innerHTML = displayData.map(proc => `
            <tr>
                <td>${proc.pid || 'N/A'}</td>
                <td>${proc.name || 'N/A'}</td>
                <td>${proc.user || 'N/A'}</td>
                <td>${proc.memory_usage_mb ? proc.memory_usage_mb.toFixed(1) : 'N/A'}</td>
                <td title="${proc.command_line || ''}">${(proc.command_line || '').substring(0, 50)}${(proc.command_line || '').length > 50 ? '...' : ''}</td>
            </tr>
        `).join('');
        
        // Reinitialize Lucide icons
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }

    displayFilteredNetwork(filtered, total, searchTerm) {
        const tableBody = document.getElementById('networkTableBody');
        const warning = document.getElementById('networkWarning');
        
        if (filtered.length > this.itemsPerPage) {
            warning.innerHTML = `<i data-lucide="alert-circle" style="width: 16px; height: 16px;"></i> Displaying ${this.itemsPerPage} of ${filtered.length} ${searchTerm ? 'matching' : ''} connections. ${total > filtered.length ? `(${total} total)` : ''} Use search to filter or export to CSV for complete data.`;
            warning.classList.remove('hidden');
        } else if (searchTerm && filtered.length < total) {
            warning.innerHTML = `<i data-lucide="alert-circle" style="width: 16px; height: 16px;"></i> Showing ${filtered.length} of ${total} connections matching "${searchTerm}".`;
            warning.classList.remove('hidden');
        } else {
            warning.classList.add('hidden');
        }
        
        const displayData = filtered.slice(0, this.itemsPerPage);
        
        tableBody.innerHTML = displayData.map(conn => `
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
        
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }

    displayFilteredPersistence(filtered, total, searchTerm) {
        const tableBody = document.getElementById('persistenceTableBody');
        const warning = document.getElementById('persistenceWarning');
        
        if (filtered.length > this.itemsPerPage) {
            warning.innerHTML = `<i data-lucide="alert-circle" style="width: 16px; height: 16px;"></i> Displaying ${this.itemsPerPage} of ${filtered.length} ${searchTerm ? 'matching' : ''} items. ${total > filtered.length ? `(${total} total)` : ''} Use search to filter or export to CSV for complete data.`;
            warning.classList.remove('hidden');
        } else if (searchTerm && filtered.length < total) {
            warning.innerHTML = `<i data-lucide="alert-circle" style="width: 16px; height: 16px;"></i> Showing ${filtered.length} of ${total} items matching "${searchTerm}".`;
            warning.classList.remove('hidden');
        } else {
            warning.classList.add('hidden');
        }
        
        const displayData = filtered.slice(0, this.itemsPerPage);
        
        tableBody.innerHTML = displayData.map(item => `
            <tr>
                <td>${item.type || 'N/A'}</td>
                <td>${item.name || 'N/A'}</td>
                <td title="${item.value || ''}">${(item.value || '').substring(0, 100)}${(item.value || '').length > 100 ? '...' : ''}</td>
                <td>${item.location || 'N/A'}</td>
                <td><span class="badge ${item.suspicious ? 'badge-critical' : 'badge-normal'}">${item.suspicious ? 'Yes' : 'No'}</span></td>
            </tr>
        `).join('');
        
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }

    displayFilteredEvents(filtered, total, searchTerm) {
        const tableBody = document.getElementById('eventsTableBody');
        const warning = document.getElementById('eventsWarning');
        
        if (filtered.length > this.itemsPerPage) {
            warning.innerHTML = `<i data-lucide="alert-circle" style="width: 16px; height: 16px;"></i> Displaying ${this.itemsPerPage} of ${filtered.length} ${searchTerm ? 'matching' : ''} events. ${total > filtered.length ? `(${total} total)` : ''} Use search to filter or export to CSV for complete data.`;
            warning.classList.remove('hidden');
        } else if (searchTerm && filtered.length < total) {
            warning.innerHTML = `<i data-lucide="alert-circle" style="width: 16px; height: 16px;"></i> Showing ${filtered.length} of ${total} events matching "${searchTerm}".`;
            warning.classList.remove('hidden');
        } else {
            warning.classList.add('hidden');
        }
        
        const displayData = filtered.slice(0, this.itemsPerPage);
        
        tableBody.innerHTML = displayData.map(event => `
            <tr>
                <td>${event.event_id || 'N/A'}</td>
                <td><span class="badge ${this.getLevelBadgeClass(event.level)}">${event.level || 'N/A'}</span></td>
                <td>${event.source || 'N/A'}</td>
                <td>${event.time_created || 'N/A'}</td>
                <td title="${event.message || ''}">${(event.message || '').substring(0, 100)}${(event.message || '').length > 100 ? '...' : ''}</td>
            </tr>
        `).join('');
        
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }

    displayFilteredPrefetch(filtered, total, searchTerm) {
        const tableBody = document.getElementById('prefetchTableBody');
        const warning = document.getElementById('prefetchWarning');
        
        if (filtered.length === 0 && total === 0) {
            tableBody.innerHTML = `
                <tr><td colspan="4" style="text-align:center; padding: 40px;">
                    <i data-lucide="alert-circle" style="width: 32px; height: 32px; color: #999; display: block; margin: 0 auto 12px;"></i>
                    <p style="color: #999; margin: 0; font-size: 14px;">No prefetch files found</p>
                    <p style="color: #666; margin: 8px 0 0 0; font-size: 12px;">This may occur if prefetch is disabled or if the CLI couldn't access C:\\\\Windows\\\\Prefetch</p>
                </td></tr>
            `;
            warning.classList.add('hidden');
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
            return;
        }
        
        if (filtered.length > this.itemsPerPage) {
            warning.innerHTML = `<i data-lucide="alert-circle" style="width: 16px; height: 16px;"></i> Displaying ${this.itemsPerPage} of ${filtered.length} ${searchTerm ? 'matching' : ''} prefetch files. ${total > filtered.length ? `(${total} total)` : ''} Use search to filter or export to CSV for complete data.`;
            warning.classList.remove('hidden');
        } else if (searchTerm && filtered.length < total) {
            warning.innerHTML = `<i data-lucide="alert-circle" style="width: 16px; height: 16px;"></i> Showing ${filtered.length} of ${total} prefetch files matching "${searchTerm}".`;
            warning.classList.remove('hidden');
        } else {
            warning.classList.add('hidden');
        }
        
        const displayData = filtered.slice(0, this.itemsPerPage);
        
        tableBody.innerHTML = displayData.map(file => `
            <tr>
                <td>${file.executable_name || 'N/A'}</td>
                <td>${file.run_count || 'N/A'}</td>
                <td>${file.last_run_time || 'N/A'}</td>
                <td title="${file.file_path || ''}">${(file.file_path || 'N/A').substring(0, 80)}${(file.file_path || '').length > 80 ? '...' : ''}</td>
            </tr>
        `).join('');
        
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }

    displayFilteredShimcache(filtered, total, searchTerm, originalTotal) {
        const tableBody = document.getElementById('shimcacheTableBody');
        const warning = document.getElementById('shimcacheWarning');
        
        if (filtered.length === 0 && total === 0) {
            tableBody.innerHTML = `
                <tr><td colspan="4" style="text-align:center; padding: 40px;">
                    <i data-lucide="alert-circle" style="width: 32px; height: 32px; color: #999; display: block; margin: 0 auto 12px;"></i>
                    <p style="color: #999; margin: 0; font-size: 14px;">No valid shimcache entries found</p>
                    <p style="color: #666; margin: 8px 0 0 0; font-size: 12px;">${originalTotal > 0 ? 'All entries appear to be corrupted or invalid' : 'The shimcache registry key may be empty or inaccessible'}</p>
                </td></tr>
            `;
            warning.classList.add('hidden');
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
            return;
        }
        
        let warningMsg = '';
        if (filtered.length > this.itemsPerPage) {
            warningMsg = `<i data-lucide="alert-circle" style="width: 16px; height: 16px;"></i> Displaying ${this.itemsPerPage} of ${filtered.length} ${searchTerm ? 'matching' : ''} shimcache entries. ${total > filtered.length ? `(${total} valid, ${originalTotal - total} corrupt filtered out)` : originalTotal > total ? `(${originalTotal - total} corrupt entries filtered out)` : ''} Use search to filter or export to CSV for complete data.`;
            warning.innerHTML = warningMsg;
            warning.classList.remove('hidden');
        } else if (searchTerm && filtered.length < total) {
            warningMsg = `<i data-lucide="alert-circle" style="width: 16px; height: 16px;"></i> Showing ${filtered.length} of ${total} shimcache entries matching "${searchTerm}".`;
            warning.innerHTML = warningMsg;
            warning.classList.remove('hidden');
        } else if (originalTotal > total) {
            warningMsg = `<i data-lucide="alert-circle" style="width: 16px; height: 16px;"></i> ${originalTotal - total} corrupt entries were filtered out. Showing ${total} valid entries.`;
            warning.innerHTML = warningMsg;
            warning.classList.remove('hidden');
        } else {
            warning.classList.add('hidden');
        }
        
        const displayData = filtered.slice(0, this.itemsPerPage);
        
        tableBody.innerHTML = displayData.map(entry => {
            const executionIcon = entry.execution_flag 
                ? '<i data-lucide="check-circle" style="width: 14px; height: 14px; color: #107C10;"></i> Yes' 
                : '<i data-lucide="circle" style="width: 14px; height: 14px; color: #999;"></i> No';
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
        
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }

    // CSV Export Functions
    exportProcessesToCSV() {
        if (!this.currentScanData || !this.currentScanData.artifacts) return;
        
        const processes = this.currentScanData.artifacts.running_processes || [];
        const headers = ['PID', 'Process Name', 'User', 'Memory (MB)', 'Command Line'];
        const rows = processes.map(proc => [
            proc.pid || '',
            proc.name || '',
            proc.user || '',
            proc.memory_usage_mb ? proc.memory_usage_mb.toFixed(1) : '',
            proc.command_line || ''
        ]);
        
        this.downloadCSV('processes.csv', headers, rows);
    }

    exportNetworkToCSV() {
        if (!this.currentScanData || !this.currentScanData.artifacts) return;
        
        const connections = this.currentScanData.artifacts.network_connections || [];
        const headers = ['Protocol', 'Local Address', 'Local Port', 'Remote Address', 'Remote Port', 'State', 'Process'];
        const rows = connections.map(conn => [
            conn.protocol || '',
            conn.local_address || '',
            conn.local_port || '',
            conn.remote_address || '',
            conn.remote_port || '',
            conn.state || '',
            conn.pid || conn.process_name || ''
        ]);
        
        this.downloadCSV('network-connections.csv', headers, rows);
    }

    exportPersistenceToCSV() {
        if (!this.currentScanData || !this.currentScanData.artifacts) return;
        
        const items = this.currentScanData.artifacts.persistence_mechanisms || [];
        const headers = ['Type', 'Name', 'Value', 'Location', 'Suspicious'];
        const rows = items.map(item => [
            item.type || '',
            item.name || '',
            item.value || '',
            item.location || '',
            item.suspicious ? 'Yes' : 'No'
        ]);
        
        this.downloadCSV('persistence-mechanisms.csv', headers, rows);
    }

    exportEventsToCSV() {
        if (!this.currentScanData || !this.currentScanData.artifacts) return;
        
        const eventLogs = this.currentScanData.artifacts.event_logs || {};
        
        // Combine all event log categories into a single array
        const allEvents = [
            ...(eventLogs.application || []).map(event => ({ ...event, log_name: 'Application' })),
            ...(eventLogs.security || []).map(event => ({ ...event, log_name: 'Security' })),
            ...(eventLogs.system || []).map(event => ({ ...event, log_name: 'System' }))
        ];
        
        const headers = ['Log Name', 'Event ID', 'Level', 'Source', 'Timestamp', 'Message'];
        const rows = allEvents.map(event => [
            event.log_name || '',
            event.event_id || '',
            event.level || '',
            event.source || '',
            event.timestamp || '',
            event.message || ''
        ]);
        
        this.downloadCSV('event-logs.csv', headers, rows);
    }

    exportPrefetchToCSV() {
        if (!this.currentScanData || !this.currentScanData.artifacts) return;
        
        const prefetch = this.currentScanData.artifacts.execution_evidence?.prefetch_files || [];
        const headers = ['Executable Name', 'Run Count', 'Last Run Time', 'File Path'];
        const rows = prefetch.map(file => [
            file.executable_name || '',
            file.run_count || '',
            file.last_run_time || '',
            file.file_path || ''
        ]);
        
        this.downloadCSV('prefetch-files.csv', headers, rows);
    }

    exportShimcacheToCSV() {
        if (!this.currentScanData || !this.currentScanData.artifacts) return;
        
        const shimcache = this.currentScanData.artifacts.execution_evidence?.shimcache_entries || [];
        
        // Filter out corrupt entries
        const validShimcache = shimcache.filter(entry => {
            if (!entry.path || entry.path.trim() === '' || entry.path === 'Invalid UTF-16') return false;
            if (entry.file_size && entry.file_size > 1099511627776) return false;
            if (entry.last_modified && entry.last_modified.includes('+') && parseInt(entry.last_modified.substring(1, 6)) > 3000) return false;
            return true;
        });
        
        const headers = ['Path', 'Last Modified', 'File Size', 'Execution Flag'];
        const rows = validShimcache.map(entry => [
            entry.path || '',
            entry.last_modified || '',
            entry.file_size || '',
            entry.execution_flag ? 'Yes' : 'No'
        ]);
        
        this.downloadCSV('shimcache-entries.csv', headers, rows);
    }

    buildFileActivityDetails(activity) {
        const escapeHtml = (text) => {
            const div = document.createElement('div');
            div.textContent = text || '';
            return div.innerHTML;
        };
        
        return `
            <div class="detail-section">
                <h4>File Information</h4>
                <div class="detail-field">
                    <span class="detail-label">Full Path:</span>
                    <span class="detail-value copyable">${escapeHtml(activity.file_path)}</span>
                </div>
                <div class="detail-field">
                    <span class="detail-label">Action:</span>
                    <span class="detail-value">${this.getActionBadge(activity.action)}</span>
                </div>
                <div class="detail-field">
                    <span class="detail-label">Timestamp:</span>
                    <span class="detail-value copyable">${escapeHtml(activity.timestamp)}</span>
                </div>
                <div class="detail-field">
                    <span class="detail-label">Source:</span>
                    <span class="detail-value">${escapeHtml(activity.source)}</span>
                </div>
            </div>
            <div class="detail-section">
                <h4>File Details</h4>
                <div class="detail-field">
                    <span class="detail-label">File Size:</span>
                    <span class="detail-value">${activity.file_size ? this.formatFileSize(activity.file_size) + ' (' + activity.file_size.toLocaleString() + ' bytes)' : 'N/A'}</span>
                </div>
                <div class="detail-field">
                    <span class="detail-label">Extension:</span>
                    <span class="detail-value">${activity.file_extension ? '.' + activity.file_extension : 'N/A'}</span>
                </div>
                ${activity.previous_path ? `
                <div class="detail-field">
                    <span class="detail-label">Previous Path:</span>
                    <span class="detail-value copyable">${escapeHtml(activity.previous_path)}</span>
                </div>
                ` : ''}
            </div>
            <div class="detail-section">
                <h4>Collection Information</h4>
                <div class="detail-field">
                    <span class="detail-label">Data Source:</span>
                    <span class="detail-value">${escapeHtml(activity.source)}</span>
                </div>
                <div class="detail-field">
                    <span class="detail-label">Formatted Timestamp:</span>
                    <span class="detail-value">${this.formatTimestamp(activity.timestamp)}</span>
                </div>
                ${activity.action === 'Deleted' ? `
                <div class="detail-field" style="grid-column: 1 / -1;">
                    <span class="detail-label">Note:</span>
                    <span class="detail-value" style="color: var(--color-status-warning);">
                        <i data-lucide="alert-triangle" style="width: 14px; height: 14px;"></i>
                        This file was deleted and moved to the Recycle Bin
                    </span>
                </div>
                ` : ''}
                ${activity.action === 'Modified' ? `
                <div class="detail-field" style="grid-column: 1 / -1;">
                    <span class="detail-label">Note:</span>
                    <span class="detail-value" style="color: var(--color-status-info);">
                        <i data-lucide="info" style="width: 14px; height: 14px;"></i>
                        File was modified within the last 24 hours
                    </span>
                </div>
                ` : ''}
            </div>
        `;
    }

    filterFileActivity(searchTerm) {
        if (!this.currentScanData || !this.currentScanData.artifacts) return;
        
        const fileActivity = this.currentScanData.artifacts.file_activity;
        if (!fileActivity || !fileActivity.activities) return;
        
        const filtered = this.filterArray(fileActivity.activities, searchTerm, ['file_path', 'action', 'source', 'file_extension']);
        
        this.displayFilteredFileActivity(filtered, fileActivity.activities.length, searchTerm);
    }

    displayFilteredFileActivity(filtered, total, searchTerm) {
        const tableBody = document.getElementById('fileActivityTableBody');
        const warning = document.getElementById('fileActivityWarning');
        
        if (filtered.length > this.itemsPerPage) {
            warning.innerHTML = `<i data-lucide="alert-circle" style="width: 16px; height: 16px;"></i> Displaying ${this.itemsPerPage} of ${filtered.length} ${searchTerm ? 'matching' : ''} activities. ${total > filtered.length ? `(${total} total)` : ''} Use search to filter or export to CSV for complete data.`;
            warning.classList.remove('hidden');
        } else if (searchTerm && filtered.length < total) {
            warning.innerHTML = `<i data-lucide="alert-circle" style="width: 16px; height: 16px;"></i> Showing ${filtered.length} of ${total} activities matching "${searchTerm}".`;
            warning.classList.remove('hidden');
        } else {
            warning.classList.add('hidden');
        }
        
        const displayData = filtered.slice(0, this.itemsPerPage);
        
        tableBody.innerHTML = displayData.map(activity => {
            const actionBadge = this.getActionBadge(activity.action);
            return `
                <tr>
                    <td>${this.formatTimestamp(activity.timestamp)}</td>
                    <td>${actionBadge}</td>
                    <td title="${activity.file_path}">${(activity.file_path || 'N/A').substring(0, 80)}${(activity.file_path || '').length > 80 ? '...' : ''}</td>
                    <td>${activity.file_size ? this.formatFileSize(activity.file_size) : 'N/A'}</td>
                    <td>${activity.file_extension || 'N/A'}</td>
                    <td>${activity.source}</td>
                </tr>
            `;
        }).join('');
        
        // Reinitialize Lucide icons
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }

    exportFileActivityToCSV() {
        if (!this.currentScanData || !this.currentScanData.artifacts) return;
        
        const fileActivity = this.currentScanData.artifacts.file_activity;
        if (!fileActivity || !fileActivity.activities) {
            console.warn('No file activity data to export');
            return;
        }
        
        const headers = ['Timestamp', 'Action', 'File Path', 'Previous Path', 'File Size', 'Extension', 'Source'];
        const rows = fileActivity.activities.map(activity => [
            activity.timestamp || '',
            activity.action || '',
            activity.file_path || '',
            activity.previous_path || '',
            activity.file_size || '',
            activity.file_extension || '',
            activity.source || ''
        ]);
        
        this.downloadCSV('file-activity-last-24h.csv', headers, rows);
    }

    downloadCSV(filename, headers, rows) {
        // Escape CSV fields
        const escapeCSV = (field) => {
            if (field === null || field === undefined) return '';
            const str = String(field);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };
        
        // Build CSV content
        let csvContent = headers.map(escapeCSV).join(',') + '\n';
        rows.forEach(row => {
            csvContent += row.map(escapeCSV).join(',') + '\n';
        });
        
        // Create blob and download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
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
        const warning = document.getElementById('prefetchWarning');
        let prefetch = this.currentScanData?.artifacts?.execution_evidence?.prefetch_files || [];
        
        if (prefetch.length === 0) {
            tableBody.innerHTML = `
                <tr><td colspan="4" style="text-align:center; padding: 40px;">
                    <i data-lucide="alert-circle" style="width: 32px; height: 32px; color: #999; display: block; margin: 0 auto 12px;"></i>
                    <p style="color: #999; margin: 0; font-size: 14px;">No prefetch files found</p>
                    <p style="color: #666; margin: 8px 0 0 0; font-size: 12px;">This may occur if prefetch is disabled or if the CLI couldn't access C:\\Windows\\Prefetch</p>
                </td></tr>
            `;
            warning.classList.add('hidden');
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
            return;
        }
        
        // Apply sorting if active
        const sortState = this.sortState.prefetch;
        if (sortState.column && sortState.direction) {
            const header = document.querySelector(`#prefetchTable th[data-sort="${sortState.column}"]`);
            const dataType = header ? header.getAttribute('data-type') : 'string';
            prefetch = this.sortData(prefetch, sortState.column, sortState.direction, dataType);
        }
        
        // Show warning if data is truncated
        if (prefetch.length > this.itemsPerPage) {
            warning.innerHTML = `<i data-lucide="alert-circle" style="width: 16px; height: 16px;"></i> Displaying first ${this.itemsPerPage} of ${prefetch.length} prefetch files. Use search to filter or export to CSV for complete data.`;
            warning.classList.remove('hidden');
        } else {
            warning.classList.add('hidden');
        }
        
        const start = (this.currentPage - 1) * this.itemsPerPage;
        const end = start + this.itemsPerPage;
        const pageData = prefetch.slice(start, end);
        
        tableBody.innerHTML = pageData.map((file, index) => `
            <tr data-index="${start + index}">
                <td>${file.executable_name || 'N/A'}</td>
                <td>${file.run_count || 'N/A'}</td>
                <td>${file.last_run_time || 'N/A'}</td>
                <td title="${file.file_path || ''}">${(file.file_path || 'N/A').substring(0, 80)}${(file.file_path || '').length > 80 ? '...' : ''}</td>
            </tr>
        `).join('');
        
        // Reinitialize Lucide icons
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }

    populateShimcacheTable() {
        const tableBody = document.getElementById('shimcacheTableBody');
        const warning = document.getElementById('shimcacheWarning');
        const shimcache = this.currentScanData?.artifacts?.execution_evidence?.shimcache_entries || [];
        
        // Filter out obviously corrupt entries (invalid paths, unrealistic dates/sizes)
        let validShimcache = shimcache.filter(entry => {
            // Filter out entries with empty paths or "Invalid UTF-16"
            if (!entry.path || entry.path.trim() === '' || entry.path === 'Invalid UTF-16') return false;
            // Filter out entries with unrealistic file sizes (> 1TB = 1099511627776 bytes)
            if (entry.file_size && entry.file_size > 1099511627776) return false;
            // Filter out entries with dates far in the future (> year 3000)
            if (entry.last_modified && entry.last_modified.includes('+') && parseInt(entry.last_modified.substring(1, 6)) > 3000) return false;
            return true;
        });
        
        if (validShimcache.length === 0) {
            tableBody.innerHTML = `
                <tr><td colspan="4" style="text-align:center; padding: 40px;">
                    <i data-lucide="alert-circle" style="width: 32px; height: 32px; color: #999; display: block; margin: 0 auto 12px;"></i>
                    <p style="color: #999; margin: 0; font-size: 14px;">No valid shimcache entries found</p>
                    <p style="color: #666; margin: 8px 0 0 0; font-size: 12px;">${shimcache.length > 0 ? 'All entries appear to be corrupted or invalid' : 'The shimcache registry key may be empty or inaccessible'}</p>
                </td></tr>
            `;
            warning.classList.add('hidden');
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
            return;
        }
        
        // Apply sorting if active
        const sortState = this.sortState.shimcache;
        if (sortState.column && sortState.direction) {
            const header = document.querySelector(`#shimcacheTable th[data-sort="${sortState.column}"]`);
            const dataType = header ? header.getAttribute('data-type') : 'string';
            validShimcache = this.sortData(validShimcache, sortState.column, sortState.direction, dataType);
        }
        
        // Show warning if data is truncated
        if (validShimcache.length > this.itemsPerPage) {
            warning.innerHTML = `<i data-lucide="alert-circle" style="width: 16px; height: 16px;"></i> Displaying first ${this.itemsPerPage} of ${validShimcache.length} shimcache entries. ${shimcache.length > validShimcache.length ? `(${shimcache.length - validShimcache.length} corrupt entries filtered out)` : ''} Use search to filter or export to CSV for complete data.`;
            warning.classList.remove('hidden');
        } else if (shimcache.length > validShimcache.length) {
            warning.innerHTML = `<i data-lucide="alert-circle" style="width: 16px; height: 16px;"></i> ${shimcache.length - validShimcache.length} corrupt entries were filtered out. Showing ${validShimcache.length} valid entries.`;
            warning.classList.remove('hidden');
        } else {
            warning.classList.add('hidden');
        }
        
        const start = (this.currentPage - 1) * this.itemsPerPage;
        const end = start + this.itemsPerPage;
        const pageData = validShimcache.slice(start, end);
        
        tableBody.innerHTML = pageData.map((entry, index) => {
            const executionIcon = entry.execution_flag 
                ? '<i data-lucide="check-circle" style="width: 14px; height: 14px; color: #107C10;"></i> Yes' 
                : '<i data-lucide="circle" style="width: 14px; height: 14px; color: #999;"></i> No';
            const fileSize = entry.file_size ? this.formatFileSize(entry.file_size) : 'N/A';
            
            return `
                <tr data-index="${start + index}">
                    <td title="${entry.path || ''}">${(entry.path || 'N/A').substring(0, 60)}${(entry.path || '').length > 60 ? '...' : ''}</td>
                    <td>${this.formatTimestamp(entry.last_modified)}</td>
                    <td>${fileSize}</td>
                    <td>${executionIcon}</td>
                </tr>
            `;
        }).join('');
        
        // Reinitialize Lucide icons
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }

    populateFileActivityTable() {
        const tableBody = document.getElementById('fileActivityTableBody');
        const warning = document.getElementById('fileActivityWarning');
        const statsContainer = document.getElementById('activityStats');
        const fileActivity = this.currentScanData?.artifacts?.file_activity;
        
        if (!fileActivity || !fileActivity.activities || fileActivity.activities.length === 0) {
            tableBody.innerHTML = `
                <tr><td colspan="6" style="text-align:center; padding: 40px;">
                    <i data-lucide="alert-circle" style="width: 32px; height: 32px; color: #999; display: block; margin: 0 auto 12px;"></i>
                    <p style="color: #999; margin: 0; font-size: 14px;">No file activity found for the last 24 hours</p>
                    <p style="color: #666; margin: 8px 0 0 0; font-size: 12px;">This feature tracks file creations, modifications, deletions, and downloads</p>
                </td></tr>
            `;
            statsContainer.innerHTML = '';
            warning.classList.add('hidden');
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
            return;
        }
        
        // Display activity statistics
        const activityTypes = fileActivity.activities_by_type || {};
        const statsHTML = `
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-icon"><i data-lucide="activity"></i></div>
                    <div class="stat-content">
                        <div class="stat-value">${fileActivity.total_activities}</div>
                        <div class="stat-label">Total Activities</div>
                    </div>
                </div>
                ${Object.entries(activityTypes).map(([action, count]) => `
                    <div class="stat-card">
                        <div class="stat-icon">${this.getActionIcon(action)}</div>
                        <div class="stat-content">
                            <div class="stat-value">${count}</div>
                            <div class="stat-label">${action}</div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
        statsContainer.innerHTML = statsHTML;
        
        let activities = [...fileActivity.activities];
        
        // Apply sorting if active
        const sortState = this.sortState.fileactivity;
        if (sortState && sortState.column && sortState.direction) {
            const header = document.querySelector(`#fileActivityTable th[data-sort="${sortState.column}"]`);
            const dataType = header ? header.getAttribute('data-type') : 'string';
            activities = this.sortData(activities, sortState.column, sortState.direction, dataType);
        }
        
        // Show warning if data is truncated
        if (activities.length > this.itemsPerPage) {
            warning.innerHTML = `<i data-lucide="alert-circle" style="width: 16px; height: 16px;"></i> Displaying first ${this.itemsPerPage} of ${activities.length} activities. Use search to filter or export to CSV for complete data.`;
            warning.classList.remove('hidden');
        } else {
            warning.classList.add('hidden');
        }
        
        const start = (this.currentPage - 1) * this.itemsPerPage;
        const end = start + this.itemsPerPage;
        const pageData = activities.slice(start, end);
        
        tableBody.innerHTML = pageData.map((activity, index) => {
            const actionBadge = this.getActionBadge(activity.action);
            return `
                <tr data-index="${start + index}">
                    <td>${this.formatTimestamp(activity.timestamp)}</td>
                    <td>${actionBadge}</td>
                    <td title="${activity.file_path}">${(activity.file_path || 'N/A').substring(0, 80)}${(activity.file_path || '').length > 80 ? '...' : ''}</td>
                    <td>${activity.file_size ? this.formatFileSize(activity.file_size) : 'N/A'}</td>
                    <td>${activity.file_extension || 'N/A'}</td>
                    <td>${activity.source}</td>
                </tr>
            `;
        }).join('');
        
        // Reinitialize Lucide icons
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }

    getActionIcon(action) {
        const icons = {
            'Created': '<i data-lucide="file-plus"></i>',
            'Created/Downloaded': '<i data-lucide="download"></i>',
            'Modified': '<i data-lucide="edit"></i>',
            'Deleted': '<i data-lucide="trash-2"></i>',
            'Renamed': '<i data-lucide="file-edit"></i>',
            'Moved': '<i data-lucide="move"></i>',
            'Accessed': '<i data-lucide="eye"></i>'
        };
        return icons[action] || '<i data-lucide="file"></i>';
    }

    getActionBadge(action) {
        const badges = {
            'Created': '<span class="badge badge-success"><i data-lucide="file-plus" style="width: 12px; height: 12px;"></i> Created</span>',
            'Created/Downloaded': '<span class="badge badge-info"><i data-lucide="download" style="width: 12px; height: 12px;"></i> Downloaded</span>',
            'Modified': '<span class="badge badge-warning"><i data-lucide="edit" style="width: 12px; height: 12px;"></i> Modified</span>',
            'Deleted': '<span class="badge badge-danger"><i data-lucide="trash-2" style="width: 12px; height: 12px;"></i> Deleted</span>',
            'Renamed': '<span class="badge badge-primary"><i data-lucide="file-edit" style="width: 12px; height: 12px;"></i> Renamed</span>',
            'Moved': '<span class="badge badge-primary"><i data-lucide="move" style="width: 12px; height: 12px;"></i> Moved</span>',
            'Accessed': '<span class="badge badge-secondary"><i data-lucide="eye" style="width: 12px; height: 12px;"></i> Accessed</span>'
        };
        return badges[action] || `<span class="badge">${action}</span>`;
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