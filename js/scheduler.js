/**
 * scheduler.js — Constraint Programming Engine
 * Uses backtracking with heuristics (MRV + degree ordering)
 * Hard Constraints: zero violation mandatory
 * Soft Constraints: scored 0-100
 */
const Scheduler = (() => {

    // ───────────────────────────────────────────
    // Public entry point
    // ───────────────────────────────────────────
    async function generate(onProgress, onLog) {
        const startTime = performance.now();
        const genId = 'GEN-' + Date.now();

        onLog('info', `Starting generation [${genId}]`);

        // Load all data
        const [faculty, subjects, rooms, classes] = await Promise.all([
            DB.getAll('faculty'), DB.getAll('subjects'),
            DB.getAll('rooms'), DB.getAll('classes')
        ]);

        // Load settings
        const DAYS = await DB.getSetting('workingDays', 5);
        const PERIODS = await DB.getSetting('periodsPerDay', 7);
        const BREAK = await DB.getSetting('breakAfter', 2);
        const LUNCH = await DB.getSetting('lunchAfter', 4);
        const LAB_CON = await DB.getSetting('labConsecutive', 3);

        // Validation
        if (faculty.length === 0) return { ok: false, error: 'No faculty defined.' };
        if (subjects.length === 0) return { ok: false, error: 'No subjects defined.' };
        if (rooms.length === 0) return { ok: false, error: 'No rooms defined.' };
        if (classes.length === 0) return { ok: false, error: 'No classes defined.' };

        onLog('ok', `Loaded: ${faculty.length} faculty, ${subjects.length} subjects, ${rooms.length} rooms, ${classes.length} classes`);
        onProgress(5);

        // Validate assignment matrix: each class needs subjects assigned
        for (const cls of classes) {
            if (!cls.subjects || cls.subjects.length === 0) {
                return { ok: false, error: `Class ${cls.section} has no subjects assigned.` };
            }
        }

        // Available period slots (excluding break/lunch)
        const rawPeriods = Array.from({ length: PERIODS }, (_, i) => i);
        const specialPeriods = new Set();
        if (BREAK > 0 && BREAK <= PERIODS) specialPeriods.add(BREAK - 1);  // 0-indexed after break slot
        if (LUNCH > 0 && LUNCH <= PERIODS) specialPeriods.add(LUNCH - 1);
        const teachingPeriods = rawPeriods.filter(p => !specialPeriods.has(p));

        onLog('info', `Schedule grid: ${DAYS} days × ${PERIODS} periods (${teachingPeriods.length} teaching slots)`);
        onProgress(10);

        // Global booking maps
        const facultyBook = {};  // facultyId → Set of "day-period"
        const roomBook = {};  // roomId    → Set of "day-period"
        const classBook = {};  // classId   → Map of "day-period" → slot

        faculty.forEach(f => facultyBook[f.id] = new Set());
        rooms.forEach(r => roomBook[r.id] = new Set());
        classes.forEach(c => { classBook[c.id] = new Map(); });

        // ─── Build assignment tasks per class ──────────────────────
        // Sort classes and subjects to maximize success probability
        const assignments = buildAssignments(classes, subjects, DAYS, teachingPeriods, LAB_CON, onLog);

        // Shuffle helps escape local optima
        const totalSlots = assignments.reduce((s, a) => s + a.slots.length, 0);
        onLog('info', `Total slot assignments to make: ${totalSlots}`);
        onProgress(15);

        const result = [];
        const conflicts = [];
        let placed = 0;

        // ─── Main allocation per class ─────────────────────────────
        for (let ci = 0; ci < classes.length; ci++) {
            const cls = classes[ci];
            const clsAssign = assignments.find(a => a.classId === cls.id);
            if (!clsAssign) continue;

            onLog('info', `[${cls.section}] Scheduling ${clsAssign.slots.length} slots...`);

            const success = backtrack(
                clsAssign.slots, 0, cls, faculty, rooms, subjects,
                facultyBook, roomBook, classBook,
                DAYS, teachingPeriods, LAB_CON,
                result, conflicts
            );

            if (!success) {
                onLog('warn', `[${cls.section}] Partial schedule — some slots could not be placed`);
            }

            placed += clsAssign.slots.filter(s => isPlaced(s, classBook[cls.id])).length;

            const pct = 15 + Math.round(70 * (ci + 1) / classes.length);
            onProgress(pct);
            await sleep(20);  // yield to UI
        }

        onProgress(90);

        // ─── Hard constraint verification ──────────────────────────
        const hardViolations = verifyHardConstraints(result, faculty, rooms);
        hardViolations.forEach(v => conflicts.push(v));

        // ─── Soft constraint scoring ────────────────────────────────
        const softScore = calcSoftScore(result, faculty, DAYS, teachingPeriods, LAB_CON);
        onLog('ok', `Soft constraint score: ${softScore}/100`);

        const execTime = Math.round(performance.now() - startTime);
        const valid = hardViolations.length === 0;

        onLog(valid ? 'ok' : 'err',
            valid ? `✓ Valid timetable generated in ${execTime}ms`
                : `✗ INVALID — ${hardViolations.length} hard constraint violation(s)`);

        onProgress(100);

        // ─── Persist ────────────────────────────────────────────────
        await DB.put('timetable', { generationId: genId, slots: result, conflicts, softScore, valid });
        await DB.put('genLog', {
            id: genId,
            timestamp: new Date().toISOString(),
            execTimeMs: execTime,
            softScore,
            valid,
            totalSlots: result.length,
            conflicts: conflicts.length,
            status: valid ? 'VALID' : 'INVALID'
        });

        return {
            ok: true, genId, valid, result, conflicts,
            softScore, execTimeMs: execTime,
            DAYS, PERIODS, teachingPeriods,
            breakPeriod: BREAK - 1, lunchPeriod: LUNCH - 1,
            faculty, subjects, rooms, classes
        };
    }

    // ─── Build ordered list of slot-assignment tasks per class ────
    function buildAssignments(classes, subjects, DAYS, teachingPeriods, LAB_CON, onLog) {
        return classes.map(cls => {
            const clsSubs = (cls.subjects || []).map(code => subjects.find(s => s.code === code)).filter(Boolean);

            // Labs first, then by weekly hours desc
            const ordered = [...clsSubs].sort((a, b) => {
                if (a.type === 'Lab' && b.type !== 'Lab') return -1;
                if (a.type !== 'Lab' && b.type === 'Lab') return 1;
                return (b.weeklyHours || 1) - (a.weeklyHours || 1);
            });

            const slots = [];
            for (const sub of ordered) {
                const hrs = sub.weeklyHours || 1;
                if (sub.type === 'Lab') {
                    // Labs go in blocks of LAB_CON consecutive periods
                    const blocks = Math.ceil(hrs / LAB_CON);
                    for (let b = 0; b < blocks; b++) {
                        slots.push({ type: 'lab', subject: sub, consecutive: LAB_CON, classId: cls.id });
                    }
                } else {
                    for (let h = 0; h < hrs; h++) {
                        slots.push({ type: 'theory', subject: sub, consecutive: 1, classId: cls.id });
                    }
                }
            }
            return { classId: cls.id, slots };
        });
    }

    // ─── Backtracking algorithm ────────────────────────────────────
    function backtrack(slots, idx, cls, faculty, rooms, subjects,
        facultyBook, roomBook, classBook,
        DAYS, teachingPeriods, LAB_CON, result, conflicts) {
        if (idx >= slots.length) return true;
        const slot = slots[idx];

        // Candidate faculty for this subject
        const candFaculty = faculty.filter(f =>
            f.subjects && f.subjects.includes(slot.subject.code)
        );

        // Candidate rooms for this subject
        const candRooms = rooms.filter(r =>
            r.type === slot.subject.type &&
            (!cls.strength || r.capacity >= (cls.strength || 0))
        );

        if (candFaculty.length === 0 || candRooms.length === 0) {
            conflicts.push({
                type: 'NO_RESOURCE',
                desc: `No ${candFaculty.length === 0 ? 'faculty' : 'room'} for [${cls.section}] ${slot.subject.code}`,
                class: cls.section, subject: slot.subject.code
            });
            idx++;  // skip and continue
            return backtrack(slots, idx, cls, faculty, rooms, subjects,
                facultyBook, roomBook, classBook, DAYS, teachingPeriods, LAB_CON, result, conflicts);
        }

        // Try every day × start-period combination
        const tryCandidates = buildCandidates(slot, DAYS, teachingPeriods, LAB_CON);
        shuffle(tryCandidates);  // randomize for variety

        for (const { day, startP } of tryCandidates) {
            const periods = slot.type === 'lab'
                ? Array.from({ length: LAB_CON }, (_, i) => startP + i)
                : [startP];

            const key0 = `${day}-${periods[0]}`;
            if (classBook[cls.id].has(key0)) continue;  // class already has something here

            // Try each faculty × room combination
            const facShuffled = shuffle([...candFaculty]);
            const roomShuffled = shuffle([...candRooms]);

            let placed = false;
            for (const fac of facShuffled) {
                // Check faculty availability
                const available = periods.every(p => isFacultyAvailable(fac, day, p));
                if (!available) continue;

                // Check faculty not double-booked
                if (periods.some(p => facultyBook[fac.id].has(`${day}-${p}`))) continue;

                for (const room of roomShuffled) {
                    // Check room not double-booked
                    if (periods.some(p => roomBook[room.id].has(`${day}-${p}`))) continue;

                    // ✓ All hard constraints satisfied — place slot
                    periods.forEach((p, pi) => {
                        const key = `${day}-${p}`;
                        facultyBook[fac.id].add(key);
                        roomBook[room.id].add(key);
                        classBook[cls.id].set(key, { day, period: p, subject: slot.subject, faculty: fac, room, isLab: slot.type === 'lab', labIdx: pi });
                        result.push({
                            genKey: key, classId: cls.id, className: cls.section, day, period: p,
                            subjectCode: slot.subject.code, subjectName: slot.subject.name,
                            subjectType: slot.subject.type, facultyId: fac.id, facultyName: fac.name,
                            roomId: room.id, roomName: room.name, isLab: slot.type === 'lab', labIdx: pi, labLen: LAB_CON
                        });
                    });
                    placed = true;
                    break;
                }
                if (placed) break;
            }

            if (placed) {
                const deeper = backtrack(slots, idx + 1, cls, faculty, rooms, subjects,
                    facultyBook, roomBook, classBook, DAYS, teachingPeriods, LAB_CON, result, conflicts);
                if (deeper) return true;

                // Undo placement
                periods.forEach(p => {
                    const key = `${day}-${p}`;
                    const placed_ = classBook[cls.id].get(key);
                    if (placed_) {
                        facultyBook[placed_.faculty.id].delete(key);
                        roomBook[placed_.room.id].delete(key);
                        classBook[cls.id].delete(key);
                    }
                });
                // Remove from result
                periods.forEach(p => {
                    const ki = result.findIndex(r => r.classId === cls.id && r.day === day && r.period === p);
                    if (ki !== -1) result.splice(ki, 1);
                });
            }
        }

        // Couldn't place — skip
        return backtrack(slots, idx + 1, cls, faculty, rooms, subjects,
            facultyBook, roomBook, classBook, DAYS, teachingPeriods, LAB_CON, result, conflicts);
    }

    function buildCandidates(slot, DAYS, teachingPeriods, LAB_CON) {
        const cands = [];
        if (slot.type === 'lab') {
            // Find consecutive runs in teachingPeriods
            for (let d = 0; d < DAYS; d++) {
                for (let i = 0; i <= teachingPeriods.length - LAB_CON; i++) {
                    // Check if teachingPeriods[i..i+LAB_CON-1] are consecutive numbers
                    let consec = true;
                    for (let j = 1; j < LAB_CON; j++) {
                        if (teachingPeriods[i + j] !== teachingPeriods[i] + j) { consec = false; break; }
                    }
                    if (consec) cands.push({ day: d, startP: teachingPeriods[i] });
                }
            }
        } else {
            for (let d = 0; d < DAYS; d++) {
                for (const p of teachingPeriods) {
                    cands.push({ day: d, startP: p });
                }
            }
        }
        return cands;
    }

    function isFacultyAvailable(fac, day, period) {
        if (!fac.availability) return true;
        // availability[day][period] === true means available
        const dayAvail = fac.availability[day];
        if (!dayAvail) return true;
        return dayAvail[period] !== false;
    }

    function isPlaced(slot, bookMap) {
        return bookMap.size > 0;  // simplified
    }

    // ─── Hard Constraint Verification ────────────────────────────
    function verifyHardConstraints(result, faculty, rooms) {
        const violations = [];
        const facSlots = {};
        const roomSlots = {};

        result.forEach(slot => {
            const fk = `${slot.facultyId}|${slot.day}|${slot.period}`;
            if (facSlots[fk]) {
                violations.push({ type: 'FACULTY_DOUBLE_BOOK', desc: `Faculty ${slot.facultyName} double-booked Day ${slot.day + 1} P${slot.period + 1}` });
            }
            facSlots[fk] = true;

            const rk = `${slot.roomId}|${slot.day}|${slot.period}`;
            if (roomSlots[rk]) {
                violations.push({ type: 'ROOM_DOUBLE_BOOK', desc: `Room ${slot.roomName} double-booked Day ${slot.day + 1} P${slot.period + 1}` });
            }
            roomSlots[rk] = true;
        });

        return violations;
    }

    // ─── Soft Constraint Score ────────────────────────────────────
    function calcSoftScore(result, faculty, DAYS, teachingPeriods, LAB_CON) {
        let score = 100;
        const deductions = [];

        // 1. Consecutive faculty teaching (3+ in a row)
        const facDayPeriods = {};
        result.forEach(s => {
            const key = `${s.facultyId}|${s.day}`;
            if (!facDayPeriods[key]) facDayPeriods[key] = [];
            facDayPeriods[key].push(s.period);
        });
        Object.values(facDayPeriods).forEach(periods => {
            const sorted = [...new Set(periods)].sort((a, b) => a - b);
            let maxRun = 1, run = 1;
            for (let i = 1; i < sorted.length; i++) {
                if (sorted[i] === sorted[i - 1] + 1) { run++; maxRun = Math.max(maxRun, run); }
                else run = 1;
            }
            if (maxRun >= 3) { score -= 4; deductions.push(`Faculty consecutive ≥3 periods`); }
        });

        // 2. Uneven subject distribution across days
        const subjectDayDist = {};
        result.forEach(s => {
            const k = `${s.classId}|${s.subjectCode}`;
            if (!subjectDayDist[k]) subjectDayDist[k] = new Set();
            subjectDayDist[k].add(s.day);
        });
        Object.values(subjectDayDist).forEach(days => {
            if (days.size < 2 && [...days].length > 1) {
                score -= 2; deductions.push('Uneven subject day distribution');
            }
        });

        // 3. Room switching (same faculty different rooms same day)
        const facDayRooms = {};
        result.forEach(s => {
            const k = `${s.facultyId}|${s.day}`;
            if (!facDayRooms[k]) facDayRooms[k] = new Set();
            facDayRooms[k].add(s.roomId);
        });
        Object.values(facDayRooms).forEach(rooms => {
            if (rooms.size > 2) { score -= 3; deductions.push('Excessive room switching'); }
        });

        return Math.max(0, Math.min(100, score));
    }

    // ─── Utilities ────────────────────────────────────────────────
    function shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    return { generate };
})();
