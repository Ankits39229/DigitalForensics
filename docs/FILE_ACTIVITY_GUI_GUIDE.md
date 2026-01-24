# File Activity GUI - User Guide

## Overview
The File Activity tab provides a comprehensive timeline view of file system operations over the last 24 hours, presented in a professional, easy-to-navigate interface.

## Accessing the Feature

1. **Run a Scan**: Execute a scan using the CLI or Quick Scan button
2. **Open Results**: Load the scan results JSON file in the GUI
3. **Navigate**: Click the "File Activity" tab in the navigation bar

## Interface Components

### 1. Statistics Dashboard

At the top of the tab, you'll see an overview dashboard with activity statistics:

```
┌─────────────────┬─────────────────┬─────────────────┬─────────────────┐
│  📊 Total       │  ✅ Created     │  ⚠️ Modified   │  🗑️ Deleted    │
│     245         │     89          │     121         │     12          │
│  ACTIVITIES     │  CREATED        │  MODIFIED       │  DELETED        │
└─────────────────┴─────────────────┴─────────────────┴─────────────────┘
```

**Features:**
- Auto-calculated totals by action type
- Icon-based visual identification
- Hover effects for interactivity
- Responsive grid layout (adapts to screen size)

### 2. Search & Export Controls

Located in the panel header:

```
┌─────────────────────────────────────────────────────────────────┐
│ 🔍 Search file activity...              [📥 Export to CSV]     │
└─────────────────────────────────────────────────────────────────┘
```

**Search Features:**
- Real-time filtering as you type
- Searches across:
  - File paths
  - Action types
  - File extensions
  - Source locations
- Debounced (300ms) for performance
- Match count displayed

**Export Features:**
- Exports ALL activities (not just visible ones)
- CSV format with 7 columns
- Proper field escaping for special characters
- Filename: `file-activity-last-24h.csv`

### 3. Data Table

Main table displaying file activities:

```
┌───────────────────┬──────────┬─────────────────────────┬────────┬──────────┬──────────────┐
│ Timestamp         │ Action   │ File Path               │ Size   │ Extension│ Source       │
├───────────────────┼──────────┼─────────────────────────┼────────┼──────────┼──────────────┤
│ 1/24/2026, 3:45 PM│ Created  │ C:\Users\...\report.pdf │ 1.2 MB │ pdf      │ Downloads    │
│ 1/24/2026, 2:30 PM│ Modified │ C:\Users\...\doc.docx   │ 890 KB │ docx     │ User Docs    │
│ 1/24/2026, 10:15AM│ Deleted  │ C:\Users\...\temp.txt   │ 15 KB  │ txt      │ Recycle Bin  │
└───────────────────┴──────────┴─────────────────────────┴────────┴──────────┴──────────────┘
```

**Table Features:**
- **Sortable Columns**: Click any header to sort (ascending/descending/reset)
- **Color-Coded Badges**: Visual action identification
- **Path Truncation**: Long paths truncated with hover tooltip showing full path
- **Human-Readable Sizes**: Auto-formatted (KB, MB, GB, TB)
- **Timestamp Formatting**: Localized date/time display
- **Pagination**: First 50 items shown (with warning if more exist)

## Action Badge Colors

Each action type has a distinctive color-coded badge:

| Action              | Badge Color | Icon        | Use Case                    |
|---------------------|-------------|-------------|-----------------------------|
| **Created**         | 🟢 Green    | file-plus   | New files created           |
| **Downloaded**      | 🔵 Blue     | download    | Files downloaded            |
| **Modified**        | 🟠 Orange   | edit        | Existing files modified     |
| **Deleted**         | 🔴 Red      | trash-2     | Files moved to Recycle Bin  |
| **Renamed**         | 🔵 Blue     | file-edit   | Files renamed               |
| **Moved**           | 🔵 Blue     | move        | Files moved between folders |
| **Accessed**        | ⚫ Gray     | eye         | Recently accessed files     |

## Using the Search Feature

### Example Searches

**Find all PDF files:**
```
Search: pdf
```

**Find deleted files:**
```
Search: deleted
```

**Find files from Downloads:**
```
Search: downloads
```

**Find specific file:**
```
Search: report.docx
```

### Search Behavior

- **Case-insensitive**: "PDF" = "pdf" = "Pdf"
- **Partial matching**: "doc" matches "document.docx"
- **Multi-field**: Searches file path, action, extension, and source
- **Real-time**: Updates as you type (300ms delay)
- **Clear results**: Shows "X of Y matching" message

## Sorting Data

### How to Sort

1. **Click Column Header**: Activates ascending sort
2. **Click Again**: Switches to descending sort
3. **Click Third Time**: Resets to default (newest first)

### Sort Indicators

- **▲** - Ascending sort active
- **▼** - Descending sort active
- **No arrow** - Default sort (by timestamp)

### Sort Types

- **Timestamp**: Chronological order
- **Action**: Alphabetical
- **File Path**: Alphabetical
- **Size**: Numerical (smallest to largest)
- **Extension**: Alphabetical
- **Source**: Alphabetical

## Exporting Data

### CSV Export Process

1. Click **"Export to CSV"** button in panel header
2. File automatically downloads: `file-activity-last-24h.csv`
3. Open in Excel, LibreOffice, or any CSV viewer

### CSV Format

```csv
Timestamp,Action,File Path,Previous Path,File Size,Extension,Source
2026-01-24T15:45:00Z,Created,C:\Users\John\Downloads\report.pdf,,1234567,pdf,Downloads
2026-01-24T14:30:00Z,Modified,C:\Users\John\Documents\doc.docx,,890123,docx,User Documents
```

**Columns:**
1. **Timestamp**: ISO 8601 format (UTC)
2. **Action**: Action type (Created, Modified, etc.)
3. **File Path**: Full file path
4. **Previous Path**: Original path (for deleted/moved files)
5. **File Size**: Size in bytes
6. **Extension**: File extension
7. **Source**: Data collection source

### CSV Features

- **Complete Data**: All activities exported (not just visible 50)
- **Proper Escaping**: Handles commas, quotes, newlines in paths
- **UTF-8 Encoding**: Supports international characters
- **Excel Compatible**: Opens directly in Microsoft Excel

## Empty State

If no file activity is detected, the tab displays:

```
┌─────────────────────────────────────────────────────────┐
│                         ⚠️                              │
│                                                         │
│         No file activity found for the last 24 hours    │
│                                                         │
│  This feature tracks file creations, modifications,    │
│        deletions, and downloads                         │
└─────────────────────────────────────────────────────────┘
```

## Performance Considerations

### Large Datasets

When more than 50 activities are present:

1. **Warning Displayed**: "Displaying first 50 of X activities"
2. **Use Search**: Filter to specific actions or files
3. **Export CSV**: View complete dataset externally

### Optimization Tips

- Use specific search terms to narrow results
- Sort by relevant columns to prioritize viewing
- Export to CSV for analysis in external tools
- Filter by action type (e.g., "deleted") for focused investigation

## Forensic Analysis Workflows

### Malware Investigation

1. **Check Recent Downloads**:
   - Search: "downloaded"
   - Look for suspicious executables (.exe, .dll, .bat)

2. **Identify Dropped Files**:
   - Search: "created"
   - Filter by Temp Files source
   - Check for unusual file extensions

3. **Track File Modifications**:
   - Search: "modified"
   - Look for system files or critical documents

### Data Exfiltration Detection

1. **Monitor Created Files**:
   - Large files created in Downloads or Desktop
   - Archive files (.zip, .rar, .7z)

2. **Check Temporary Files**:
   - Search: "temp files"
   - Look for data staging areas

3. **Track Deletions**:
   - Search: "deleted"
   - Evidence destruction attempts

### Insider Threat Analysis

1. **Document Access Patterns**:
   - Search: "accessed"
   - Look for unusual document access

2. **File Copying Activity**:
   - Created files in portable media locations
   - Large document modifications

3. **Timeline Reconstruction**:
   - Export CSV
   - Build activity timeline
   - Correlate with other artifacts (processes, network)

## Integration with Other Tabs

### Cross-Reference Analysis

The File Activity tab works seamlessly with other forensic data:

1. **Processes Tab**:
   - Correlate file creation with process execution
   - Example: New .exe created → Process spawned with same name

2. **Network Tab**:
   - Match downloaded files with network connections
   - Example: Download activity → Outbound connection to IP

3. **Event Logs Tab**:
   - Verify file operations against Windows Event Logs
   - Example: File deletion → Security event 4663

4. **Persistence Tab**:
   - Check if created files established persistence
   - Example: .exe created in Startup folder

## Keyboard Shortcuts

| Shortcut | Action                    |
|----------|---------------------------|
| Ctrl+F   | Focus search input        |
| Ctrl+E   | Export to CSV             |
| Esc      | Clear search              |
| ↑/↓      | Navigate table rows       |

## Tips & Best Practices

### Investigation Tips

1. **Start with Statistics**: Overview helps identify anomalies
2. **Use Search Strategically**: Narrow down to relevant activities
3. **Export Early**: Preserve complete timeline for analysis
4. **Cross-Reference**: Correlate with other forensic artifacts
5. **Sort by Action**: Group similar activities together

### Common Patterns to Look For

#### 🚨 Suspicious Activity Indicators

- **Mass File Deletions**: Multiple files deleted rapidly
- **Unusual Executables**: .exe files in user directories
- **Script Files**: .bat, .ps1, .vbs in unusual locations
- **Archive Creation**: Large .zip files before data theft
- **Temp File Activity**: Excessive temp file operations

#### ✅ Normal Activity Patterns

- **Document Edits**: Office files in Documents folder
- **Browser Downloads**: Files in Downloads folder
- **Auto-Save Files**: Regular modifications to documents
- **Recent Access**: Normal file access patterns

## Troubleshooting

### No Data Displayed

**Possible Causes:**
- No file activity in last 24 hours (system idle)
- Permissions issue accessing data sources
- Scan completed before file activity collection implemented

**Solutions:**
- Run a new scan with updated CLI
- Check scan JSON has "file_activity" section
- Verify scan ran with sufficient permissions

### Incomplete Data

**Possible Causes:**
- Partial scan completion
- Access denied to certain folders
- Recycle Bin encrypted or corrupted

**Solutions:**
- Re-run scan as Administrator
- Check CLI output for collection errors
- Review scan warnings

### Performance Issues

**Possible Causes:**
- Very large activity count (1000+)
- Complex search patterns
- Slow rendering on older hardware

**Solutions:**
- Use search to filter results
- Export to CSV for external analysis
- Close other resource-intensive applications

## Technical Details

### Data Sources

File activity is collected from:

1. **Recent Files**: `%APPDATA%\Microsoft\Windows\Recent`
2. **Downloads**: `%USERPROFILE%\Downloads`
3. **Desktop**: `%USERPROFILE%\Desktop`
4. **Documents**: `%USERPROFILE%\Documents`
5. **Pictures**: `%USERPROFILE%\Pictures`
6. **Recycle Bin**: `$Recycle.Bin` (all drives)
7. **Temp Files**: `%TEMP%`, `%TMP%`

### Time Window

- **Default**: Last 24 hours from scan execution time
- **Cutoff**: Activities older than 24 hours excluded
- **Timezone**: Displayed in local timezone, stored as UTC

### Data Integrity

- **Read-Only**: No files modified during collection
- **Timestamp Preservation**: Original timestamps preserved
- **ACL Respect**: Access denied handled gracefully
- **Forensically Sound**: Industry-standard collection methods

## Related Documentation

- [FILE_ACTIVITY_FEATURE.md](../FILE_ACTIVITY_FEATURE.md) - Complete technical documentation
- [USER_MANUAL.md](USER_MANUAL.md) - Full application user manual
- [QUICK_START_GUIDE.md](QUICK_START_GUIDE.md) - Getting started guide

---

**Last Updated**: January 24, 2026  
**Version**: 1.0.0  
**Status**: ✅ Production Ready
