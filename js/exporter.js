/**
 * exporter.js — CSV and PDF export utilities (pure browser-based)
 * Uses jsPDF (loaded from CDN) and manual CSV construction
 */
const Exporter = (() => {

    // ─── CSV Export ───────────────────────────────────────────────
    function exportCSV(data, filename) {
        const rows = data.map(r => Object.values(r).map(v =>
            typeof v === 'string' && v.includes(',') ? `"${v}"` : v
        ).join(','));
        const headers = Object.keys(data[0] || {}).join(',');
        const csv = [headers, ...rows].join('\n');
        downloadText(csv, filename, 'text/csv');
    }

    function timetableToCSV(result, classes, DAYS, PERIODS, DAY_NAMES, teachingPeriods) {
        const rows = [];
        rows.push(['Class', 'Day', 'Period', 'Subject Code', 'Subject Name', 'Faculty', 'Room', 'Type']);
        result.forEach(s => {
            rows.push([s.className, DAY_NAMES[s.day], `P${s.period + 1}`,
            s.subjectCode, s.subjectName, s.facultyName, s.roomName, s.subjectType]);
        });
        const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
        downloadText(csv, 'timetable.csv', 'text/csv');
    }

    function downloadText(content, filename, mime) {
        const blob = new Blob([content], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
    }

    // ─── PDF Export (uses jsPDF loaded from CDN) ──────────────────
    function exportPDF(result, classes, DAYS, PERIODS, DAY_NAMES, teachingPeriods, softScore, genId, execTimeMs) {
        if (typeof window.jspdf === 'undefined') {
            alert('PDF library not loaded. Please check internet connection.');
            return;
        }
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });

        // Title
        doc.setFontSize(18);
        doc.setFont('helvetica', 'bold');
        doc.text('Automated Timetable', 14, 18);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100);
        doc.text(`Generation ID: ${genId}  |  Soft Score: ${softScore}/100  |  Time: ${execTimeMs}ms  |  Generated: ${new Date().toLocaleString()}`, 14, 26);
        doc.setTextColor(0);

        const classGroups = {};
        result.forEach(s => {
            if (!classGroups[s.classId]) classGroups[s.classId] = [];
            classGroups[s.classId].push(s);
        });

        let yOffset = 34;

        Object.entries(classGroups).forEach(([classId, slots]) => {
            const cls = classes.find(c => c.id === classId);
            if (!cls) return;

            if (yOffset > 160) { doc.addPage(); yOffset = 14; }

            doc.setFontSize(13); doc.setFont('helvetica', 'bold');
            doc.text(`Class: ${cls.section}`, 14, yOffset); yOffset += 6;

            // Build grid
            const grid = {};
            slots.forEach(s => { grid[`${s.day}-${s.period}`] = s; });

            // Table headers
            const colW = 34, rowH = 8, startX = 14;
            const headerCols = ['Day / Period', ...teachingPeriods.map(p => `P${p + 1}`)];
            doc.setFontSize(7); doc.setFont('helvetica', 'bold');
            headerCols.forEach((col, ci) => {
                doc.setFillColor(99, 102, 241);
                doc.setTextColor(255);
                doc.rect(startX + ci * colW, yOffset, colW, rowH, 'F');
                doc.text(col, startX + ci * colW + 1, yOffset + 5.5);
            });
            yOffset += rowH; doc.setFont('helvetica', 'normal'); doc.setTextColor(0);

            for (let d = 0; d < DAYS; d++) {
                if (yOffset > 185) { doc.addPage(); yOffset = 14; }
                // Day label
                doc.setFillColor(240, 242, 255); doc.setFont('helvetica', 'bold');
                doc.rect(startX, yOffset, colW, rowH, 'F');
                doc.setFontSize(8);
                doc.text(DAY_NAMES[d], startX + 1, yOffset + 5.5);
                doc.setFont('helvetica', 'normal'); doc.setFontSize(7);

                teachingPeriods.forEach((p, pi) => {
                    const s = grid[`${d}-${p}`];
                    const x = startX + (pi + 1) * colW;
                    if (s) {
                        const bg = s.isLab ? [139, 92, 246] : [99, 102, 241];
                        doc.setFillColor(...bg.map(v => v * 0.3 + 180));
                        doc.rect(x, yOffset, colW, rowH, 'F');
                        doc.text(`${s.subjectCode}`, x + 1, yOffset + 3.5);
                        doc.text(`${s.facultyName.split(' ').slice(-1)[0]}`, x + 1, yOffset + 6.5);
                    } else {
                        doc.setFillColor(248, 248, 248);
                        doc.rect(x, yOffset, colW, rowH, 'F');
                        doc.text('—', x + colW / 2 - 1, yOffset + 5.5);
                    }
                });
                yOffset += rowH;
            }
            yOffset += 8;
        });

        doc.save(`timetable_${genId}.pdf`);
    }

    return { exportCSV, timetableToCSV, exportPDF, downloadText };
})();
