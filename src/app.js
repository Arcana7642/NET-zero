const COURSE_NO = "학수번호";
const LECTURE_TIME = "강의시간";
const CLASSROOM = "강의실";
const DAYS = ["월", "화", "수", "목", "금", "토", "일"];
const DAY_INDEX = Object.fromEntries(DAYS.map((day, index) => [day, index]));
const MINUTES_PER_DAY = 24 * 60;
const FIRST_PERIOD_MINUTE = 9 * 60;
const PERIOD_MINUTES = 30;

// 이 번호의 엘리베이터는 커스텀 정책에서 항상 전층을 담당합니다(자동 최적화/수동 편집과 무관하게 고정).
const UNIVERSAL_ELEVATOR_ID = 1;

const DEFAULT_STOP_SERVICE = {
  deceleration: { min: 1, max: 2 },
  doorOpen: 2,
  transfer: { min: 6, max: 10 },
  doorClose: { min: 2, max: 2 },
  reacceleration: { min: 1, max: 2 },
};

const state = {
  rawRows: [],
  lectures: [],
  calls: [],
  assignments: [],
  assignmentsByElevator: new Map(),
  demandRows: [],
  summary: null,
  selectedId: null,
  playbackTime: 0,
  timeMin: 0,
  timeMax: 1,
  playing: false,
  playTimer: null,
  customPolicies: null,
  customPeriodPolicies: {},
  customPeriodSignature: null,
  editingPeriod: "base",
  periodSummaries: [],
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  bindEvents();
  loadDefaultCsv();
});

function cacheElements() {
  [
    "csvFile",
    "daySelect",
    "policyButtons",
    "seedInput",
    "minStudentsInput",
    "maxStudentsInput",
    "elevatorCountInput",
    "capacityInput",
    "totalFloorsInput",
    "travelSecondsInput",
    "decelMinInput",
    "decelMaxInput",
    "doorOpenInput",
    "transferMinInput",
    "transferMaxInput",
    "doorCloseMinInput",
    "doorCloseMaxInput",
    "reaccelMinInput",
    "reaccelMaxInput",
    "metricsGrid",
    "policyName",
    "elevatorPolicyGrid",
    "policyEditor",
    "currentTimeLabel",
    "playButton",
    "pauseButton",
    "timeSlider",
    "buildingGrid",
    "selectedBadge",
    "selectedDetail",
    "courseSearch",
    "lectureTableBody",
    "assignmentCount",
    "assignmentTableBody",
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  els.rerunButton = document.getElementById("rerunButton"); // may be null
  els.daySelect.addEventListener("change", runSimulation);
  [
    els.seedInput,
    els.minStudentsInput,
    els.maxStudentsInput,
    els.elevatorCountInput,
    els.capacityInput,
    els.totalFloorsInput,
    els.travelSecondsInput,
    els.decelMinInput,
    els.decelMaxInput,
    els.doorOpenInput,
    els.transferMinInput,
    els.transferMaxInput,
    els.doorCloseMinInput,
    els.doorCloseMaxInput,
    els.reaccelMinInput,
    els.reaccelMaxInput,
  ].forEach((input) => input.addEventListener("change", runSimulation));

  els.policyButtons.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-policy]");
    if (!button) return;
    const policy = button.dataset.policy;
    activatePolicyButton(policy);
    if (policy === "custom") {
      applyOptimalToCustom();
    } else if (policy === "opt") {
      // opt: 사전계산된 최적 정책을 즉시 로드 (계산 없이 적용만)
      applyOptimalToCustom();
    } else {
      // 프리셋 선택 시 시간대별 오버라이드 초기화하고 즉시 해당 프리셋 적용
      state.customPeriodPolicies = {};
      state.editingPeriod = "base";
    }
    runSimulation();
  });

  els.policyEditor.addEventListener("click", handlePolicyEditorClick);

  els.csvFile.addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    setRowsFromCsv(await file.text());
    runSimulation();
  });

  els.timeSlider.addEventListener("input", () => {
    state.playbackTime = Number(els.timeSlider.value);
    renderLiveViews();
  });

  els.playButton.addEventListener("click", startPlayback);
  els.pauseButton.addEventListener("click", stopPlayback);
  els.courseSearch.addEventListener("input", renderLectureTable);
}

async function loadDefaultCsv() {
  try {
    const response = await fetch("lecture_room_time_course.csv", { cache: "no-store" });
    if (!response.ok) throw new Error(`CSV ${response.status}`);
    setRowsFromCsv(await response.text());
  } catch (error) {
    // file://로 직접 열면 fetch가 막히므로 임베드된 CSV(lecture_data.js)로 대체합니다.
    if (typeof window !== "undefined" && window.EMBEDDED_LECTURE_CSV) {
      setRowsFromCsv(window.EMBEDDED_LECTURE_CSV);
    } else {
      showEmptyState("lecture_room_time_course.csv를 자동으로 읽지 못했습니다. CSV 불러오기를 사용하세요.");
    }
  }
  runSimulation();
}

function setRowsFromCsv(text) {
  state.rawRows = parseCsv(text);
  state.lectures = state.rawRows.map(rowToLecture).filter(Boolean);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  if (!rows.length) return [];
  const headers = rows.shift().map((header, index) =>
    index === 0 ? header.replace(/^\uFEFF/, "") : header,
  );

  return rows
    .filter((item) => item.some((value) => value.trim()))
    .map((item) => {
      const record = {};
      headers.forEach((header, index) => {
        record[header] = item[index] ?? "";
      });
      return record;
    });
}

function rowToLecture(row) {
  const classroom = (row[CLASSROOM] || "").trim();
  const floor = extractFloor(classroom);
  const meetings = parseMeetings(row[LECTURE_TIME] || "");
  if (floor === null || !meetings.length) return null;
  return {
    courseNo: (row[COURSE_NO] || "").trim(),
    lectureTime: (row[LECTURE_TIME] || "").trim(),
    classroom,
    floor,
    meetings,
  };
}

function parseMeetings(value) {
  const meetings = [];
  let currentDay = null;
  let periods = [];
  // 괄호 안은 대체 강의실 주석(예: "화13,14,15(2남227)")이므로 교시 파싱에서 제거합니다.
  const tokens = value.replace(/\([^)]*\)/g, " ").match(/[월화수목금토일]|\d+/g) || [];

  for (const token of tokens) {
    if (DAY_INDEX[token] !== undefined) {
      if (currentDay && periods.length) {
        meetings.push({ day: currentDay, periods });
      }
      currentDay = token;
      periods = [];
    } else if (currentDay) {
      periods.push(Number(token));
    }
  }

  if (currentDay && periods.length) {
    meetings.push({ day: currentDay, periods });
  }
  return meetings;
}

function extractFloor(classroom) {
  const match = classroom.match(/-(\d{3,4})$/);
  if (!match) return null;
  return Math.floor(Number(match[1]) / 100);
}

function getConfig() {
  const minStudents = clamp(readNumber(els.minStudentsInput, 25), 1, 80);
  const maxStudents = Math.max(minStudents, clamp(readNumber(els.maxStudentsInput, 30), 1, 100));
  const demandSeed = readNumber(els.seedInput, 2026);

  els.minStudentsInput.value = minStudents;
  els.maxStudentsInput.value = maxStudents;

  return {
    day: els.daySelect.value,
    policy: getPolicyName(),
    demandSeed,
    minStudents,
    maxStudents,
    elevatorCount: clamp(readNumber(els.elevatorCountInput, 3), 1, 8),
    capacity: clamp(readNumber(els.capacityInput, 20), 1, 30),
    minFloor: 0,
    totalFloors: clamp(readNumber(els.totalFloorsInput, 14), 2, 30),
    lobbyFloor: 1,
    travelMinutesPerFloor: clamp(readNumber(els.travelSecondsInput, 3), 3, 60) / 60,
    stopService: getStopServiceConfig(),
  };
}

function getStopServiceConfig() {
  return {
    deceleration: readRange(els.decelMinInput, els.decelMaxInput, 1, 2),
    doorOpen: clamp(readNumber(els.doorOpenInput, 2), 0, 60),
    transfer: readRange(els.transferMinInput, els.transferMaxInput, 6, 10),
    doorClose: readRange(els.doorCloseMinInput, els.doorCloseMaxInput, 2, 2),
    reacceleration: readRange(els.reaccelMinInput, els.reaccelMaxInput, 1, 2),
  };
}

function readRange(minInput, maxInput, fallbackMin, fallbackMax) {
  const min = Math.max(0, readNumber(minInput, fallbackMin));
  const max = Math.max(min, readNumber(maxInput, fallbackMax));
  minInput.value = min;
  maxInput.value = max;
  return { min, max };
}

function getPolicyName() {
  const active = els.policyButtons.querySelector("button.active");
  return active?.dataset.policy || "odd_even";
}

function activatePolicyButton(policy) {
  [...els.policyButtons.querySelectorAll("button[data-policy]")].forEach((button) => {
    button.classList.toggle("active", button.dataset.policy === policy);
  });
}

function readNumber(input, fallback) {
  const value = Number(input.value);
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function runSimulation() {
  stopPlayback();
  const config = getConfig();
  if (config.policy === "custom" || config.policy === "opt") {
    ensureCustomPolicies(config);
  } else {
    syncCustomPolicyFromPreset(config.policy, config);
  }
  const usableLectures = state.lectures.filter(
    (lecture) => lecture.floor >= config.minFloor && lecture.floor <= config.totalFloors,
  );
  const { calls, demandRows } = buildCalls(usableLectures, config);
  const { assignments, assignmentsByElevator } = simulate(calls, config);

  state.calls = calls;
  state.assignments = assignments;
  state.assignmentsByElevator = assignmentsByElevator;
  state.demandRows = demandRows;
  state.summary = summarize(assignments, config);
  state.periodSummaries = summarizePeriods(assignments);

  if (assignments.length) {
    state.timeMin = Math.floor(Math.min(...assignments.map((item) => item.firstArrivalTime)));
    state.timeMax = Math.ceil(Math.max(...assignments.map((item) => item.dropoffTime)));
    const selectedStillExists = assignments.some((item) => item.id === state.selectedId);
    if (!selectedStillExists) state.selectedId = assignments[0].id;
    const selected = getSelectedAssignment();
    state.playbackTime = selected ? selected.requestTime : state.timeMin;
  } else {
    state.timeMin = 0;
    state.timeMax = 1;
    state.playbackTime = 0;
    state.selectedId = null;
  }

  updateTimelineBounds();
  renderAll();
}

function handlePolicyEditorClick(event) {
  // 1) 시간대 탭 전환 (재시뮬레이션 없이 편집 대상만 변경)
  const periodButton = event.target.closest("button[data-period]");
  if (periodButton) {
    state.editingPeriod = periodButton.dataset.period;
    renderPolicyEditor();
    return;
  }

  // 2) 담당층 토글 (현재 편집 중인 시간대 또는 기본)
  const button = event.target.closest("button[data-elevator-id][data-floor]");
  if (!button) return;

  const config = getConfig();
  const elevatorId = Number(button.dataset.elevatorId);
  // 전층 고정 엘리베이터는 편집할 수 없습니다.
  if (elevatorId === universalElevatorId(config)) return;
  const periodKey = getEditingPeriodKey();
  const target = periodKey == null ? ensureCustomPolicies(config) : ensurePeriodPolicy(config, periodKey);
  const floor = Number(button.dataset.floor);
  const floors = new Set(target.floorsByElevator[elevatorId] || []);

  if (floors.has(floor)) {
    floors.delete(floor);
  } else {
    floors.add(floor);
  }

  target.floorsByElevator[elevatorId] = normalizeFloors([...floors], config);
  activatePolicyButton("custom");
  runSimulation();
}

function buildCalls(lectures, config) {
  const rng = mulberry32(config.demandSeed);
  const calls = [];
  const demandRows = [];
  let callId = 1;
  let studentSerial = 1;
  let demandId = 1;

  for (const lecture of lectures) {
    for (const meeting of lecture.meetings) {
      if (meeting.day !== config.day) continue;
      const classStudents = randInt(rng, config.minStudents, config.maxStudents);
      const start = minuteForPeriod(meeting.day, Math.min(...meeting.periods));
      const end = minuteForPeriod(meeting.day, Math.max(...meeting.periods) + 1);

      demandRows.push({
        id: demandId,
        courseNo: lecture.courseNo,
        classroom: lecture.classroom,
        lectureTime: lecture.lectureTime,
        floor: lecture.floor,
        day: meeting.day,
        start,
        end,
        classStudents,
      });
      demandId += 1;

      const studentIds = Array.from({ length: classStudents }, () => {
        const id = `${lecture.courseNo}-S${String(studentSerial).padStart(5, "0")}`;
        studentSerial += 1;
        return id;
      });

      const upOrder = shuffledIndices(classStudents, rng);
      const downOrder = shuffledIndices(classStudents, rng);

      callId = appendQueueArrivals({
        calls,
        callId,
        lecture,
        meeting,
        kind: "before_class",
        origin: config.lobbyFloor,
        destination: lecture.floor,
        queueTime: start,
        classStudents,
        studentIds,
        queueOrder: upOrder,
      });

      callId = appendQueueArrivals({
        calls,
        callId,
        lecture,
        meeting,
        kind: "after_class",
        origin: lecture.floor,
        destination: config.lobbyFloor,
        queueTime: end,
        classStudents,
        studentIds,
        queueOrder: downOrder,
      });
    }
  }

  calls.sort((a, b) => a.requestTime - b.requestTime || a.queueOrder - b.queueOrder || a.id - b.id);
  return { calls, demandRows };
}

function appendQueueArrivals({
  calls,
  callId,
  lecture,
  meeting,
  kind,
  origin,
  destination,
  queueTime,
  classStudents,
  studentIds,
  queueOrder,
}) {
  for (let index = 0; index < classStudents; index += 1) {
    const studentIndex = index + 1;
    const order = queueOrder[index];
    calls.push({
      id: callId,
      requestTime: queueTime,
      firstArrivalTime: queueTime,
      lastArrivalTime: queueTime,
      averageArrivalTime: queueTime,
      origin,
      destination,
      courseNo: lecture.courseNo,
      classroom: lecture.classroom,
      floor: lecture.floor,
      day: meeting.day,
      kind,
      passengers: 1,
      classStudents,
      studentIndex,
      studentId: studentIds[index],
      studentLabel: `${studentIds[index]}-${kind === "before_class" ? "UP" : "DOWN"}`,
      queueOrder: order,
      arrivalTimes: [queueTime],
    });
    callId += 1;
  }
  return callId;
}

function minuteForPeriod(day, period) {
  return DAY_INDEX[day] * MINUTES_PER_DAY + FIRST_PERIOD_MINUTE + (period - 1) * PERIOD_MINUTES;
}

function shuffledIndices(count, rng) {
  const values = Array.from({ length: count }, (_, index) => index + 1);
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
  }
  return values;
}

function simulate(calls, config) {
  const elevators = Array.from({ length: config.elevatorCount }, (_, index) => ({
    id: index + 1,
    currentFloor: config.lobbyFloor,
    availableAt: 0,
    servedCalls: 0,
    passengerLoad: 0,
    totalDistance: 0,
  }));
  const serviceRng = mulberry32(serviceSeedFromConfig(config));
  const assignments = [];
  const studentElevators = new Map();
  const eventGroups = groupQueueEvents(calls);
  let roundRobin = 0;
  let tripId = 1;

  for (const event of eventGroups) {
    const queues = buildFloorQueues(event.students, event.kind, studentElevators);

    while (hasQueuedStudents(queues)) {
      let madeAssignment = false;
      const elevatorOrder = [...elevators].sort(
        (a, b) => a.availableAt - b.availableAt || a.id - b.id,
      );

      for (const elevator of elevatorOrder) {
        const floor = chooseStopFloor({
          queues,
          elevator,
          event,
          config,
          roundRobin,
        });
        if (floor === null) continue;
        if (config.policy === "all") roundRobin += 1;

        const riders = dequeueStudents(queues, floor, config.capacity);
        if (!riders.length) continue;

        const assignment = createStopAssignment({
          tripId,
          riders,
          floor,
          event,
          elevator,
          config,
          serviceRng,
        });
        assignments.push(assignment);

        if (event.kind === "before_class") {
          riders.forEach((student) => studentElevators.set(student.studentId, elevator.id));
        }

        elevator.currentFloor = assignment.call.destination;
        elevator.availableAt = assignment.dropoffTime;
        elevator.servedCalls += 1;
        elevator.passengerLoad += assignment.call.passengers;
        elevator.totalDistance += assignment.travelDistance;
        madeAssignment = true;
        tripId += 1;
      }

      if (!madeAssignment) break;
    }
  }

  const assignmentsByElevator = new Map();
  for (const assignment of assignments) {
    if (!assignmentsByElevator.has(assignment.elevatorId)) {
      assignmentsByElevator.set(assignment.elevatorId, []);
    }
    assignmentsByElevator.get(assignment.elevatorId).push(assignment);
  }

  return { assignments, assignmentsByElevator };
}

function groupQueueEvents(calls) {
  const groups = new Map();
  for (const call of calls.filter((item) => item.origin !== item.destination)) {
    const key = `${call.requestTime}|${call.kind}`;
    if (!groups.has(key)) {
      groups.set(key, { time: call.requestTime, kind: call.kind, students: [] });
    }
    groups.get(key).students.push(call);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      students: group.students.sort((a, b) => a.queueOrder - b.queueOrder || a.id - b.id),
    }))
    .sort((a, b) => a.time - b.time || eventKindPriority(a.kind) - eventKindPriority(b.kind));
}

function eventKindPriority(kind) {
  return kind === "after_class" ? 0 : 1;
}

function buildFloorQueues(students, kind, studentElevators) {
  const queues = new Map();
  for (const student of students) {
    const floor = kind === "before_class" ? student.destination : student.origin;
    const queuedStudent =
      kind === "after_class"
        ? { ...student, preferredElevatorId: studentElevators.get(student.studentId) || null }
        : student;
    if (!queues.has(floor)) queues.set(floor, []);
    queues.get(floor).push(queuedStudent);
  }
  for (const queue of queues.values()) {
    queue.sort((a, b) => a.queueOrder - b.queueOrder || a.id - b.id);
  }
  return queues;
}

function hasQueuedStudents(queues) {
  for (const queue of queues.values()) {
    if (queue.length) return true;
  }
  return false;
}

function dequeueStudents(queues, floor, capacity) {
  const queue = queues.get(floor) || [];
  const riders = queue.splice(0, capacity);
  if (!queue.length) queues.delete(floor);
  return riders;
}

function chooseStopFloor({ queues, elevator, event, config, roundRobin, profile }) {
  const useProfile = profile || getElevatorProfile(elevator.id, config, periodKeyForTime(event.time));
  const floors = [...queues.entries()]
    .filter(([, queue]) => queue.length)
    .filter(([floor]) => floorIsAllowed(useProfile, floor))
    .map(([floor]) => floor);
  if (!floors.length) return null;

  if (config.policy === "all") {
    return floors.sort((a, b) => a - b)[roundRobin % floors.length];
  }

  let bestFloor = floors[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const floor of floors) {
    const queue = queues.get(floor);
    const candidateRiders = queue.slice(0, config.capacity);
    const origin = event.kind === "before_class" ? config.lobbyFloor : floor;
    const destination = event.kind === "before_class" ? floor : config.lobbyFloor;
    const travelCost =
      Math.abs(elevator.currentFloor - origin) + Math.abs(origin - destination);
    const served = candidateRiders.length;
    const queuePressure = queue.length;
    const highFloorBonus = event.kind === "after_class" ? floor * 1.8 : floor * 0.35;
    const returnMatchBonus =
      event.kind === "after_class"
        ? candidateRiders.filter((student) => student.preferredElevatorId === elevator.id).length * 2.4
        : 0;
    const profileCenterPenalty = Math.abs(floor - useProfile.center) * 0.25;
    const priorityBonus =
      config.policy === "priority" && useProfile.primary?.includes(floor) ? 2.2 : 0;
    const nearestPenalty = travelCost * (config.policy === "odd_even" ? 1.15 : 1);
    const score =
      served * 6 +
      queuePressure * 1.2 +
      highFloorBonus +
      returnMatchBonus +
      priorityBonus -
      nearestPenalty -
      profileCenterPenalty;

    if (score > bestScore) {
      bestScore = score;
      bestFloor = floor;
    }
  }
  return bestFloor;
}

function getElevatorProfile(elevatorId, config, periodKey = null) {
  if (config.policy === "custom" || config.policy === "opt") {
    return getCustomElevatorProfile(elevatorId, config, periodKey);
  }
  return getPresetElevatorProfile(config.policy, elevatorId, config);
}

function getPresetElevatorProfile(policy, elevatorId, config) {
  const floors = range(config.minFloor, config.totalFloors);
  if (policy === "all") {
    return {
      label: "전체층",
      floors: withLobbyFloor(floors, config),
      primary: withLobbyFloor(floors, config),
      center: average(floors),
    };
  }

  if (policy === "zone") {
    // E1은 항상 전층 운행
    if (elevatorId === 1) {
      return {
        label: "전층",
        floors: withLobbyFloor(floors, config),
        primary: withLobbyFloor(floors, config),
        center: average(floors),
      };
    }
    // E2, E3은 1층 + 5~9층 고정
    if (elevatorId === 2 || elevatorId === 3) {
      const zoneFloors = [1, ...boundedRange(5, 9, config)];
      return {
        label: "1,5-9층",
        floors: withLobbyFloor(zoneFloors, config),
        primary: withLobbyFloor(zoneFloors, config),
        center: average(zoneFloors),
      };
    }
    // E4 이상은 균등 분할
    const zones = makeEqualZones(config);
    const zone = zones[(elevatorId - 1) % zones.length];
    return {
      label: zone.label,
      floors: withLobbyFloor(zone.floors, config),
      primary: withLobbyFloor(zone.floors, config),
      center: average(zone.floors),
    };
  }

  if (policy === "priority") {
    const profiles = [
      { label: "홀수 우선", floors: withLobbyFloor(floors.filter((floor) => floor % 2 !== 0), config), primary: withLobbyFloor(floors.filter((floor) => floor % 2 !== 0), config) },
      { label: "짝수 우선", floors: withLobbyFloor(floors.filter((floor) => floor % 2 === 0), config), primary: withLobbyFloor(floors.filter((floor) => floor % 2 === 0), config) },
      { label: "1-7 우선", floors: withLobbyFloor(boundedRange(config.minFloor, 7, config), config), primary: withLobbyFloor(boundedRange(config.minFloor, 7, config), config) },
      { label: `8-${config.totalFloors} 우선`, floors: withLobbyFloor(boundedRange(8, config.totalFloors, config), config), primary: withLobbyFloor(boundedRange(8, config.totalFloors, config), config) },
    ];
    const profile = profiles[(elevatorId - 1) % profiles.length];
    return { ...profile, center: average(profile.floors) };
  }

  const parity = elevatorId % 2 === 1 ? 1 : 0;
  const parityLabel = parity === 1 ? "홀수층" : "짝수층";
  const parityFloors = withLobbyFloor(floors.filter((floor) => Math.abs(floor % 2) === parity), config);
  return {
    label: parityLabel,
    floors: parityFloors,
    primary: parityFloors,
    center: average(parityFloors),
  };
}

function getCustomElevatorProfile(elevatorId, config, periodKey = null) {
  const floorsByElevator = resolveCustomFloorsByElevator(config, periodKey);
  const floors = normalizeFloors(floorsByElevator[elevatorId] || [], config);
  const isOpt = config.policy === "opt";
  const hasOverride = periodKey != null && state.customPeriodPolicies[periodKey];
  const label = isOpt ? (hasOverride ? "opt(시간대)" : "opt") : (hasOverride ? "커스텀(시간대)" : "커스텀");
  return {
    label,
    floors,
    primary: floors,
    center: average(floors),
  };
}

// 30분 단위 시간대 키(해당 시간대의 시작 절대분)를 돌려줍니다.
function periodKeyForTime(time) {
  const day = Math.floor(time / MINUTES_PER_DAY);
  const within = time - day * MINUTES_PER_DAY;
  const slot = Math.floor((within - FIRST_PERIOD_MINUTE) / PERIOD_MINUTES);
  return day * MINUTES_PER_DAY + FIRST_PERIOD_MINUTE + slot * PERIOD_MINUTES;
}

// 현재 수요가 존재하는 30분 시간대 목록(정렬된 키 배열).
function getPeriodSlots() {
  const demandKeys = state.calls.map((call) => periodKeyForTime(call.requestTime));
  if (!demandKeys.length) return [];
  const minKey = Math.min(...demandKeys);
  const maxKey = Math.max(...demandKeys);
  // 첫 시간대부터 마지막 시간대까지 30분 단위로 빈틈없이 채움
  const slots = [];
  for (let key = minKey; key <= maxKey; key += PERIOD_MINUTES) {
    slots.push(key);
  }
  return slots;
}

// 설정(엘리베이터 수/층수)이 바뀌면 시간대별 오버라이드를 초기화합니다.
function ensurePeriodPoliciesValid(config) {
  const signature = customPolicySignature(config);
  if (state.customPeriodSignature !== signature) {
    state.customPeriodPolicies = {};
    state.customPeriodSignature = signature;
  }
}

// 특정 시간대의 오버라이드가 없으면 기본 커스텀을 복사해 새로 만듭니다.
function ensurePeriodPolicy(config, periodKey) {
  ensurePeriodPoliciesValid(config);
  if (!state.customPeriodPolicies[periodKey]) {
    const base = ensureCustomPolicies(config);
    const floorsByElevator = {};
    for (let elevatorId = 1; elevatorId <= config.elevatorCount; elevatorId += 1) {
      floorsByElevator[elevatorId] = [...(base.floorsByElevator[elevatorId] || [])];
    }
    state.customPeriodPolicies[periodKey] = { floorsByElevator };
  }
  return state.customPeriodPolicies[periodKey];
}

// 시뮬레이션/렌더링에서 쓸 담당층 표를 시간대 오버라이드 우선으로 돌려줍니다.
// 전층 고정 엘리베이터는 저장값과 무관하게 항상 모든 층을 담당하도록 적용합니다.
function resolveCustomFloorsByElevator(config, periodKey) {
  ensurePeriodPoliciesValid(config);
  const stored =
    periodKey != null && state.customPeriodPolicies[periodKey]
      ? state.customPeriodPolicies[periodKey].floorsByElevator
      : ensureCustomPolicies(config).floorsByElevator;
  return applyUniversalElevator(stored, config);
}

// 현재 설정에서 전층 고정 엘리베이터 번호(없으면 null).
function universalElevatorId(config) {
  return UNIVERSAL_ELEVATOR_ID <= config.elevatorCount ? UNIVERSAL_ELEVATOR_ID : null;
}

// 저장값을 변형하지 않고, 전층 고정 엘리베이터만 모든 층으로 덮어쓴 새 표를 만듭니다.
function applyUniversalElevator(floorsByElevator, config) {
  const universal = universalElevatorId(config);
  const allFloors = range(config.minFloor, config.totalFloors);
  const result = {};
  for (let elevatorId = 1; elevatorId <= config.elevatorCount; elevatorId += 1) {
    result[elevatorId] =
      elevatorId === universal ? allFloors : withLobbyFloor(floorsByElevator[elevatorId] || [], config);
  }
  return result;
}

function getEditingPeriodKey() {
  return state.editingPeriod === "base" ? null : Number(state.editingPeriod);
}

// 시간대(30분)별 소요시간 계산.
// durationMinutes: 시간대 시작 ~ 마지막 하차까지(이 시간대 수요를 모두 처리하는 데 걸린 시간)
// clearMinutes: 첫 호출 ~ 마지막 하차까지(실제 처리 구간)
function summarizePeriods(assignments) {
  const groups = new Map();
  for (const assignment of assignments) {
    const key = periodKeyForTime(assignment.call.requestTime);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        calls: 0,
        passengers: 0,
        firstRequest: Number.POSITIVE_INFINITY,
        lastDropoff: Number.NEGATIVE_INFINITY,
        upCalls: 0,
        downCalls: 0,
      });
    }
    const group = groups.get(key);
    group.calls += 1;
    group.passengers += assignment.call.passengers;
    group.firstRequest = Math.min(group.firstRequest, assignment.call.requestTime);
    group.lastDropoff = Math.max(group.lastDropoff, assignment.dropoffTime);
    if (assignment.call.kind === "before_class") group.upCalls += 1;
    else group.downCalls += 1;
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      durationMinutes: group.lastDropoff - group.key,
      clearMinutes: group.lastDropoff - group.firstRequest,
    }))
    .sort((a, b) => a.key - b.key);
}

// 30분 자동 최적화 버튼: 사전계산 결과를 무시하고 지금 즉석에서 완전탐색으로 다시 계산합니다.
function runAutoOptimize() {
  const config = getConfig();
  if (!state.calls.length) {
    runSimulation();
    return;
  }
  ensureCustomPolicies(config);
  state.customPeriodPolicies = getOptimalPeriodPolicies(config, { forceLive: true }).policies;
  state.customPeriodSignature = customPolicySignature(config);
  activatePolicyButton("custom");
  runSimulation();
}

// 커스텀 정책 선택 시 호출: 사전계산된 최적(설정 일치 시)을 불러와 적용합니다.
function applyOptimalToCustom() {
  const config = getConfig();
  if (!state.calls.length) return;
  ensureCustomPolicies(config);
  state.customPeriodPolicies = getOptimalPeriodPolicies(config).policies;
  state.customPeriodSignature = customPolicySignature(config);
}

// 사전계산(optimal_custom.js) 결과가 현재 설정·요일과 맞으면 그대로 사용, 아니면 즉석 완전탐색.
function getOptimalPeriodPolicies(config, options) {
  const forceLive = options && options.forceLive;
  if (!forceLive && typeof window !== "undefined" && window.PRECOMPUTED_OPTIMAL) {
    const pre = window.PRECOMPUTED_OPTIMAL;
    const day = pre.days && pre.days[config.day];
    if (pre.signature === optimalSignature(config) && day) {
      const policies = {};
      for (const key of Object.keys(day)) {
        policies[key] = { floorsByElevator: day[key].floorsByElevator };
      }
      return { policies, source: "precomputed" };
    }
  }
  return { policies: computeOptimalPeriodPoliciesExhaustive(config).policies, source: "live" };
}

// 사전계산 매칭용 서명: 최적화 결과에 영향을 주는 모든 설정을 담습니다(요일 제외 — 요일별로 따로 저장).
function optimalSignature(config) {
  const service = config.stopService || DEFAULT_STOP_SERVICE;
  const round5 = (value) => Number(value.toFixed(5));
  return [
    "v1",
    config.elevatorCount,
    config.capacity,
    config.minFloor,
    config.totalFloors,
    config.lobbyFloor,
    config.minStudents,
    config.maxStudents,
    config.demandSeed,
    serviceSeedFromConfig(config),
    round5(config.travelMinutesPerFloor),
    service.deceleration.min,
    service.deceleration.max,
    service.doorOpen,
    service.transfer.min,
    service.transfer.max,
    service.doorClose.min,
    service.doorClose.max,
    service.reacceleration.min,
    service.reacceleration.max,
    UNIVERSAL_ELEVATOR_ID,
  ].join("|");
}

// 모든 시간대에 대해 완전탐색 최적화를 수행합니다.
function computeOptimalPeriodPoliciesExhaustive(config, budget = 2000000) {
  const callsByPeriod = groupCallsByPeriod(config);
  const policies = {};
  const report = [];
  for (const [key, periodCalls] of callsByPeriod) {
    const result = optimizePeriodPolicyExhaustive(periodCalls, config, budget);
    policies[key] = { floorsByElevator: result.floorsByElevator };
    report.push({ key, method: result.method, combos: result.combos, cost: result.cost });
  }
  return { policies, report };
}

// 한 시간대: 전층 고정 외 엘리베이터들이 각 수요 층을 담당할지에 대한 "모든 조합"을 평가해 소요시간(makespan) 최소를 찾습니다.
// 조합 수가 budget을 넘으면 휴리스틱+국소탐색으로 대체합니다.
function optimizePeriodPolicyExhaustive(periodCalls, config, budget = 2000000) {
  const evalConfig = { ...config, policy: "custom" };
  const universal = universalElevatorId(config);
  const others = [];
  for (let id = 1; id <= config.elevatorCount; id += 1) if (id !== universal) others.push(id);
  const allFloors = range(config.minFloor, config.totalFloors);

  const demandFloors = [...new Set(periodCalls.map((call) => call.floor))]
    .filter((floor) => floor !== config.lobbyFloor)
    .sort((a, b) => a - b);

  // 보조 엘리베이터가 없거나 수요 층이 없으면 전층 고정 한 대가 전부 담당.
  if (!others.length || !demandFloors.length) {
    const out = {};
    for (let id = 1; id <= config.elevatorCount; id += 1) out[id] = id === universal ? allFloors : [];
    return { floorsByElevator: out, method: "trivial", combos: 1, cost: evaluatePeriod(periodCalls, evalConfig, out) };
  }

  const optionsPerFloor = 1 << others.length; // 각 층을 담당하는 보조 엘리베이터 부분집합: 2^(보조 대수)
  const totalCombos = Math.pow(optionsPerFloor, demandFloors.length);

  if (totalCombos > budget) {
    const floors = optimizePeriodPolicy(periodCalls, config);
    return {
      floorsByElevator: floors,
      method: "heuristic",
      combos: 0,
      cost: evaluatePeriod(periodCalls, evalConfig, floors),
    };
  }

  let best = null;
  let bestCost = Number.POSITIVE_INFINITY;
  for (let combo = 0; combo < totalCombos; combo += 1) {
    const floorSets = {};
    for (const id of others) floorSets[id] = [];
    let remaining = combo;
    for (const floor of demandFloors) {
      const digit = remaining % optionsPerFloor;
      remaining = Math.floor(remaining / optionsPerFloor);
      for (let j = 0; j < others.length; j += 1) {
        if (digit & (1 << j)) floorSets[others[j]].push(floor);
      }
    }
    const candidate = {};
    for (let id = 1; id <= config.elevatorCount; id += 1) {
      candidate[id] = id === universal ? allFloors : normalizeFloors(floorSets[id], config);
    }
    const cost = evaluatePeriod(periodCalls, evalConfig, candidate);
    if (cost < bestCost - 1e-9) {
      bestCost = cost;
      best = candidate;
    }
  }
  return { floorsByElevator: best, method: "exhaustive", combos: totalCombos, cost: bestCost };
}

// 각 시간대를 실제로 시뮬레이션해 소요시간을 측정하고, 여러 후보 정책 중 소요시간이 가장 짧은 것을 고릅니다.
function computeOptimalPeriodPolicies(config) {
  const callsByPeriod = groupCallsByPeriod(config);
  const policies = {};
  for (const [key, periodCalls] of callsByPeriod) {
    policies[key] = { floorsByElevator: optimizePeriodPolicy(periodCalls, config) };
  }
  return policies;
}

function groupCallsByPeriod(config) {
  const byPeriod = new Map();
  for (const call of state.calls) {
    if (call.origin === call.destination) continue;
    const key = periodKeyForTime(call.requestTime);
    if (!byPeriod.has(key)) byPeriod.set(key, []);
    byPeriod.get(key).push(call);
  }
  return byPeriod;
}

// 한 시간대의 담당층 배정을 최적화: 후보 비교 + 국소 탐색으로 소요시간을 최소화.
function optimizePeriodPolicy(periodCalls, config) {
  const evalConfig = { ...config, policy: "custom" };
  const universal = universalElevatorId(config);
  const others = [];
  for (let id = 1; id <= config.elevatorCount; id += 1) if (id !== universal) others.push(id);

  const demandFloors = [...new Set(periodCalls.map((call) => call.floor))]
    .filter((floor) => floor !== config.lobbyFloor)
    .sort((a, b) => a - b);

  const candidates = [
    buildAllCandidate(config),
    applyUniversalElevator(balanceFloorsByLoad(demandPassengerMap(periodCalls, config), config), config),
    buildZoneCandidate(demandFloors, others, config),
    buildParityCandidate(demandFloors, others, config),
  ];

  let best = candidates[0];
  let bestCost = evaluatePeriod(periodCalls, evalConfig, best);
  for (let index = 1; index < candidates.length; index += 1) {
    const cost = evaluatePeriod(periodCalls, evalConfig, candidates[index]);
    if (cost < bestCost - 1e-9) {
      bestCost = cost;
      best = candidates[index];
    }
  }

  return localSearchPeriod(best, bestCost, periodCalls, evalConfig, others, demandFloors, config);
}

// 전층 고정 외 엘리베이터의 담당층을 한 층씩 토글하며 소요시간이 줄면 채택(언덕오르기).
function localSearchPeriod(startFloors, startCost, periodCalls, evalConfig, others, demandFloors, config) {
  let current = applyUniversalElevator(startFloors, config);
  let bestCost = startCost;
  let improved = true;
  let guard = 0;

  while (improved && guard < 3) {
    improved = false;
    guard += 1;
    for (const elevatorId of others) {
      for (const floor of demandFloors) {
        const floors = new Set(current[elevatorId]);
        if (floors.has(floor)) floors.delete(floor);
        else floors.add(floor);
        const trial = { ...current, [elevatorId]: normalizeFloors([...floors], config) };
        const cost = evaluatePeriod(periodCalls, evalConfig, trial);
        if (cost < bestCost - 1e-9) {
          current = trial;
          bestCost = cost;
          improved = true;
        }
      }
    }
  }
  return current;
}

// 후보 정책 한 개를 그 시간대 수요만으로 격리 시뮬레이션해 소요시간(makespan: 시작~마지막 하차)을 측정합니다.
// 목적함수를 makespan으로 두면 부하가 여러 대로 균형 있게 분산되어(병렬 처리) 대기시간이 최소화됩니다.
// (총 가동시간은 수요로 거의 고정되어 줄일 수 없고, 격리 가동시간을 최소화하면 한 대에 몰려 전역적으로 더 나빠집니다.)
function evaluatePeriod(periodCalls, config, floorsByElevator) {
  const elevators = Array.from({ length: config.elevatorCount }, (_, index) => ({
    id: index + 1,
    currentFloor: config.lobbyFloor,
    availableAt: 0,
  }));
  const profiles = {};
  for (let id = 1; id <= config.elevatorCount; id += 1) {
    profiles[id] = floorsToProfile(floorsByElevator[id] || [], config);
  }
  const serviceRng = mulberry32(serviceSeedFromConfig(config));
  const studentElevators = new Map();
  const eventGroups = groupQueueEvents(periodCalls);
  let lastDropoff = Number.NEGATIVE_INFINITY;
  let periodStart = Number.POSITIVE_INFINITY;
  let tripId = 1;

  for (const event of eventGroups) {
    periodStart = Math.min(periodStart, event.time);
    const queues = buildFloorQueues(event.students, event.kind, studentElevators);
    while (hasQueuedStudents(queues)) {
      let made = false;
      const order = [...elevators].sort((a, b) => a.availableAt - b.availableAt || a.id - b.id);
      for (const elevator of order) {
        const floor = chooseStopFloor({
          queues,
          elevator,
          event,
          config,
          roundRobin: 0,
          profile: profiles[elevator.id],
        });
        if (floor === null) continue;
        const riders = dequeueStudents(queues, floor, config.capacity);
        if (!riders.length) continue;
        const assignment = createStopAssignment({ tripId, riders, floor, event, elevator, config, serviceRng });
        lastDropoff = Math.max(lastDropoff, assignment.dropoffTime);
        if (event.kind === "before_class") {
          riders.forEach((student) => studentElevators.set(student.studentId, elevator.id));
        }
        elevator.currentFloor = assignment.call.destination;
        elevator.availableAt = assignment.dropoffTime;
        made = true;
        tripId += 1;
      }
      if (!made) break;
    }
  }
  return Number.isFinite(lastDropoff) ? lastDropoff - periodStart : 0;
}

function floorsToProfile(floors, config) {
  const normalized = normalizeFloors(floors, config);
  return { floors: normalized, primary: normalized, center: average(normalized) };
}

function demandPassengerMap(periodCalls, config) {
  const map = new Map();
  for (const call of periodCalls) {
    if (call.floor === config.lobbyFloor) continue;
    map.set(call.floor, (map.get(call.floor) || 0) + call.passengers);
  }
  return map;
}

// 모든 엘리베이터가 전층을 담당하는 후보(최대 유연성 기준선).
function buildAllCandidate(config) {
  const allFloors = range(config.minFloor, config.totalFloors);
  const out = {};
  for (let id = 1; id <= config.elevatorCount; id += 1) out[id] = allFloors;
  return out;
}

// 전층 고정 엘리베이터는 전층, 나머지는 빈 담당층으로 시작하는 틀.
function withUniversalBase(config) {
  const universal = universalElevatorId(config);
  const allFloors = range(config.minFloor, config.totalFloors);
  const out = {};
  for (let id = 1; id <= config.elevatorCount; id += 1) out[id] = id === universal ? allFloors : [];
  return out;
}

// 수요 층을 비전층 엘리베이터에 연속 구간으로 분할.
function buildZoneCandidate(demandFloors, others, config) {
  const out = withUniversalBase(config);
  if (others.length && demandFloors.length) {
    const chunk = Math.ceil(demandFloors.length / others.length);
    others.forEach((id, index) => {
      out[id] = normalizeFloors(demandFloors.slice(index * chunk, (index + 1) * chunk), config);
    });
  }
  return out;
}

// 수요 층을 비전층 엘리베이터에 번갈아 배정.
function buildParityCandidate(demandFloors, others, config) {
  const out = withUniversalBase(config);
  if (others.length) {
    demandFloors.forEach((floor, index) => out[others[index % others.length]].push(floor));
    others.forEach((id) => {
      out[id] = normalizeFloors(out[id], config);
    });
  }
  return out;
}

// 트립 단위 LPT(긴 작업 우선) 분배: 수요가 큰 층은 여러 대가 나눠 담당하도록 균형을 맞춥니다.
// 전층 고정 엘리베이터는 분배에서 제외하고 무조건 모든 층을 담당하게 둡니다.
function balanceFloorsByLoad(floorMap, config) {
  const universal = universalElevatorId(config);
  const candidates = [];
  const floorSets = {};
  const loads = {};
  for (let elevatorId = 1; elevatorId <= config.elevatorCount; elevatorId += 1) {
    floorSets[elevatorId] = new Set();
    loads[elevatorId] = 0;
    if (elevatorId !== universal) candidates.push(elevatorId);
  }

  // 층별 필요한 운행 횟수(=수요/정원)만큼 트립을 만들고, 트립 비용은 층 높이에 비례.
  const trips = [];
  for (const [floor, passengers] of floorMap) {
    const tripCount = Math.max(1, Math.ceil(passengers / config.capacity));
    const tripCost = Math.max(1, Math.abs(floor - config.lobbyFloor));
    for (let index = 0; index < tripCount; index += 1) {
      trips.push({ floor, cost: tripCost });
    }
  }
  trips.sort((a, b) => b.cost - a.cost || a.floor - b.floor);

  // 전층 고정 외 엘리베이터가 없으면(예: 1대뿐) 전층 고정 한 대가 전부 담당.
  if (candidates.length) {
    for (const trip of trips) {
      let best = candidates[0];
      for (const elevatorId of candidates) {
        if (loads[elevatorId] < loads[best]) best = elevatorId;
      }
      floorSets[best].add(trip.floor);
      loads[best] += trip.cost;
    }
  }

  const floorsByElevator = {};
  const allFloors = range(config.minFloor, config.totalFloors);
  for (let elevatorId = 1; elevatorId <= config.elevatorCount; elevatorId += 1) {
    floorsByElevator[elevatorId] =
      elevatorId === universal ? allFloors : normalizeFloors([...floorSets[elevatorId]], config);
  }
  return floorsByElevator;
}

function customPolicySignature(config) {
  return `${config.elevatorCount}|${config.minFloor}|${config.totalFloors}`;
}

function ensureCustomPolicies(config) {
  const signature = customPolicySignature(config);
  if (!state.customPolicies) {
    return syncCustomPolicyFromPreset("odd_even", config);
  }

  if (state.customPolicies.signature !== signature) {
    const previous = state.customPolicies.floorsByElevator || {};
    const floorsByElevator = {};
    for (let elevatorId = 1; elevatorId <= config.elevatorCount; elevatorId += 1) {
      const keptFloors = normalizeFloors(previous[elevatorId] || [], config);
      floorsByElevator[elevatorId] = keptFloors.length
        ? keptFloors
        : getPresetElevatorProfile("odd_even", elevatorId, config).floors;
    }
    state.customPolicies = { signature, floorsByElevator };
  }

  return state.customPolicies;
}

function syncCustomPolicyFromPreset(policy, config) {
  const sourcePolicy = policy === "custom" ? "odd_even" : policy;
  const floorsByElevator = {};
  for (let elevatorId = 1; elevatorId <= config.elevatorCount; elevatorId += 1) {
    floorsByElevator[elevatorId] = normalizeFloors(
      getPresetElevatorProfile(sourcePolicy, elevatorId, config).floors,
      config,
    );
  }
  state.customPolicies = {
    signature: customPolicySignature(config),
    floorsByElevator,
  };
  return state.customPolicies;
}

function normalizeFloors(floors, config) {
  return [...new Set(floors.map(Number))]
    .filter((floor) => Number.isFinite(floor))
    .map((floor) => Math.floor(floor))
    .filter((floor) => floor >= config.minFloor && floor <= config.totalFloors)
    .sort((a, b) => a - b);
}

function withLobbyFloor(floors, config) {
  return normalizeFloors([config.lobbyFloor, ...floors], config);
}

function serviceSeedFromConfig(config) {
  return (Number(config.demandSeed) || 2026) + 1;
}

function floorIsAllowed(profile, floor) {
  return profile.floors.includes(floor);
}

function range(start, end) {
  const from = Math.max(0, Math.floor(start));
  const to = Math.max(from, Math.floor(end));
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

function boundedRange(start, end, config) {
  const from = clamp(Math.floor(start), config.minFloor, config.totalFloors);
  const to = clamp(Math.floor(end), config.minFloor, config.totalFloors);
  if (to < from) return [];
  return range(from, to);
}

function makeEqualZones(config) {
  const floors = range(config.minFloor, config.totalFloors);
  const chunkSize = Math.ceil(floors.length / config.elevatorCount);
  return Array.from({ length: config.elevatorCount }, (_, index) => {
    const chunk = floors.slice(index * chunkSize, (index + 1) * chunkSize);
    const safeChunk = chunk.length ? chunk : [config.lobbyFloor];
    return {
      label: `${safeChunk[0]}-${safeChunk[safeChunk.length - 1]}층`,
      floors: safeChunk,
    };
  });
}

function policyLabel(policy) {
  return {
    odd_even: "홀짝 전용",
    zone: "구간 전용",
    all: "전체 운행",
    priority: "혼합 우선",
    custom: "커스텀 운행",
    opt: "최적화(30분)",
  }[policy] || "홀짝 전용";
}

function createStopAssignment({ tripId, riders, floor, event, elevator, config, serviceRng }) {
  const origin = event.kind === "before_class" ? config.lobbyFloor : floor;
  const destination = event.kind === "before_class" ? floor : config.lobbyFloor;
  const call = makeTripCall(tripId, riders, event, origin, destination, floor, elevator.id);
  const pickupService = sampleStopService(serviceRng, config.stopService);
  const dropoffService = sampleStopService(serviceRng, config.stopService);
  const readyAt = Math.max(elevator.availableAt, event.time);
  const startFloor = elevator.currentFloor;
  const toOrigin = Math.abs(startFloor - origin);
  const tripDistance = Math.abs(origin - destination);
  const startMoveTime = readyAt;
  const pickupTime = readyAt + toOrigin * config.travelMinutesPerFloor;
  const pickupEndTime = pickupTime + pickupService.totalSeconds / 60;
  const dropoffStartTime = pickupEndTime + tripDistance * config.travelMinutesPerFloor;
  const dropoffTime = dropoffStartTime + dropoffService.totalSeconds / 60;

  return {
    id: call.id,
    call,
    elevatorId: elevator.id,
    scheduledFloor: floor,
    startFloor,
    startMoveTime,
    pickupTime,
    pickupEndTime,
    dropoffStartTime,
    dropoffTime,
    waitMinutes: pickupTime - call.averageArrivalTime,
    maxWaitMinutes: pickupTime - call.firstArrivalTime,
    travelDistance: toOrigin + tripDistance,
    pickupService,
    dropoffService,
    firstArrivalTime: call.firstArrivalTime,
    requestTime: call.requestTime,
  };
}

function makeTripCall(id, riders, event, origin, destination, scheduledFloor, elevatorId) {
  const arrivalTimes = riders.map((student) => student.requestTime);
  const courseNos = unique(riders.map((student) => student.courseNo));
  const classrooms = unique(riders.map((student) => student.classroom));
  const floors = unique(riders.map((student) => student.floor));
  const first = riders[0];
  const returnMatches =
    event.kind === "after_class"
      ? riders.filter((student) => student.preferredElevatorId === elevatorId).length
      : riders.length;

  return {
    id,
    requestTime: Math.min(...arrivalTimes),
    firstArrivalTime: Math.min(...arrivalTimes),
    lastArrivalTime: Math.max(...arrivalTimes),
    averageArrivalTime: average(arrivalTimes),
    origin,
    destination,
    courseNo: courseNos.length === 1 ? courseNos[0] : `${courseNos.length}개 강의`,
    classroom: classrooms.length === 1 ? classrooms[0] : `${classrooms.length}개 강의실`,
    floor: floors.length === 1 ? floors[0] : scheduledFloor,
    day: first.day,
    kind: event.kind,
    passengers: riders.length,
    classStudents: riders.reduce((sum, student) => sum + student.classStudents, 0),
    scheduledFloor,
    returnMatches,
    students: riders,
    arrivalTimes,
  };
}

function unique(values) {
  return [...new Set(values)];
}

function sampleStopService(rng, service) {
  const ranges = service || DEFAULT_STOP_SERVICE;
  const deceleration = randFloat(rng, ranges.deceleration.min, ranges.deceleration.max);
  const doorOpen = ranges.doorOpen;
  const transfer = randFloat(rng, ranges.transfer.min, ranges.transfer.max);
  const doorClose = randFloat(rng, ranges.doorClose.min, ranges.doorClose.max);
  const reacceleration = randFloat(rng, ranges.reacceleration.min, ranges.reacceleration.max);
  return {
    deceleration,
    doorOpen,
    transfer,
    doorClose,
    reacceleration,
    totalSeconds: deceleration + doorOpen + transfer + doorClose + reacceleration,
  };
}

function summarize(assignments, config) {
  const passengers = assignments.reduce((sum, item) => sum + item.call.passengers, 0);
  const weightedWait = assignments.reduce(
    (sum, item) => sum + item.waitMinutes * item.call.passengers,
    0,
  );
  const maxWait = Math.max(0, ...assignments.map((item) => item.maxWaitMinutes));
  const totalDistance = assignments.reduce((sum, item) => sum + item.travelDistance, 0);
  const stopSeconds = assignments.flatMap((item) => [
    item.pickupService.totalSeconds,
    item.dropoffService.totalSeconds,
  ]);
  const loads = {};
  const passengerLoads = {};
  for (let index = 1; index <= config.elevatorCount; index += 1) {
    loads[index] = 0;
    passengerLoads[index] = 0;
  }
  assignments.forEach((item) => {
    loads[item.elevatorId] += 1;
    passengerLoads[item.elevatorId] += item.call.passengers;
  });

  return {
    calls: assignments.length,
    passengers,
    averageWait: passengers ? weightedWait / passengers : 0,
    maxWait,
    totalDistance,
    averageStopSeconds: average(stopSeconds),
    totalStopSeconds: stopSeconds.reduce((sum, value) => sum + value, 0),
    loads,
    passengerLoads,
  };
}

function updateTimelineBounds() {
  els.timeSlider.min = String(state.timeMin);
  els.timeSlider.max = String(state.timeMax);
  els.timeSlider.value = String(state.playbackTime);
}

function renderAll() {
  renderMetrics();
  renderPolicyEditor();
  renderPolicyGrid();
  renderLectureTable();
  renderAssignmentTable();
  renderLiveViews();
  renderCarbonDashboard();
}

function renderCarbonDashboard() {
  if (typeof CarbonModule !== "undefined" && state.assignments.length > 0) {
    CarbonModule.renderCarbonPanel("carbonPanel", state.assignments, getConfig());
  }
}

function renderLiveViews() {
  els.timeSlider.value = String(state.playbackTime);
  els.currentTimeLabel.textContent = formatSimTime(state.playbackTime);
  renderPolicyGrid();
  renderBuilding();
  renderSelectedDetail();
  highlightAssignmentRow();
}

function renderPolicyEditor() {
  const config = getConfig();
  ensureCustomPolicies(config);
  ensurePeriodPoliciesValid(config);

  const slots = getPeriodSlots();
  if (state.editingPeriod === "base" || !slots.includes(Number(state.editingPeriod))) {
    state.editingPeriod = slots.length ? String(slots[0]) : "base";
  }
  const periodKey = getEditingPeriodKey();
  const targetFloors = resolveCustomFloorsByElevator(config, periodKey);

  const allFloors = range(config.minFloor, config.totalFloors);
  const uncoveredFloors = getUncoveredFloors(targetFloors, config);
  if (els.customCoverageLabel) {
    els.customCoverageLabel.textContent = uncoveredFloors.length
      ? `미담당 ${formatFloorList(uncoveredFloors)}층`
      : "모든 층 담당";
    els.customCoverageLabel.classList.toggle("coverage-warning", uncoveredFloors.length > 0);
  }

  const tabsHtml = renderPeriodTabs(slots);
  const editingLabel = periodKey == null ? "기본 (전 시간대)" : `${formatSimTime(periodKey)} 시간대`;
  const editingHtml = `
    <div class="period-editing-label">
      <span>편집 중: <strong>${escapeHtml(editingLabel)}</strong></span>
    </div>
  `;

  const universal = universalElevatorId(config);
  const rowsHtml = Array.from({ length: config.elevatorCount }, (_, index) => {
    const elevatorId = index + 1;
    const isUniversal = elevatorId === universal;
    const selectedFloors = new Set(normalizeFloors(targetFloors[elevatorId] || [], config));
    const floorButtons = allFloors
      .map((floor) => {
        const isActive = selectedFloors.has(floor);
        const isLobby = floor === config.lobbyFloor;
        return `
          <button
            type="button"
            class="floor-toggle${isActive ? " active" : ""}${isLobby ? " lobby" : ""}"
            data-elevator-id="${elevatorId}"
            data-floor="${floor}"
            aria-pressed="${isActive}"
            ${isUniversal ? "disabled" : ""}
            title="E${elevatorId} ${floor}층"
          >${floor}</button>
        `;
      })
      .join("");
    return `
      <article class="policy-editor-row${isUniversal ? " universal" : ""}">
        <div class="policy-editor-label">
          <strong>E${elevatorId}</strong>
          ${isUniversal ? `<span class="universal-badge">전층 고정</span>` : ""}
          <span>${formatFloorList([...selectedFloors])}</span>
        </div>
        <div class="floor-toggle-grid">${floorButtons}</div>
      </article>
    `;
  }).join("");

  els.policyEditor.innerHTML = tabsHtml + editingHtml + rowsHtml;
}

function renderPeriodTabs(slots) {
  const summaryByKey = new Map((state.periodSummaries || []).map((item) => [item.key, item]));
  const slotTabs = slots
    .map((key) => {
      const summary = summaryByKey.get(key);
      const overridden = !!state.customPeriodPolicies[key];
      const isActive = String(key) === String(state.editingPeriod);
      const detail = summary
        ? `소요 ${formatNumber(summary.durationMinutes * 60)}초 · ${summary.passengers}명`
        : "수요 없음";
      return `
        <button
          type="button"
          class="period-tab${isActive ? " active" : ""}${overridden ? " overridden" : ""}"
          data-period="${key}"
          title="${formatSimTime(key)}${overridden ? " · 시간대 커스텀 적용" : ""}"
        >${formatClock(key)}${overridden ? " ●" : ""}<small>${detail}</small></button>
      `;
    })
    .join("");
  return `<div class="period-tabs">${slotTabs}</div>`;
}

function getUncoveredFloors(floorsByElevator, config) {
  const covered = new Set(
    Object.values(floorsByElevator || {}).flatMap((floors) => normalizeFloors(floors, config)),
  );
  return range(config.minFloor, config.totalFloors).filter((floor) => !covered.has(floor));
}

function renderPolicyGrid() {
  const config = getConfig();
  const periodKey = periodKeyForTime(state.playbackTime);
  els.policyName.textContent = policyLabel(config.policy);
  els.elevatorPolicyGrid.innerHTML = Array.from({ length: config.elevatorCount }, (_, index) => {
    const elevatorId = index + 1;
    const profile = getElevatorProfile(elevatorId, config, periodKey);
    const plan = getElevatorPlan(elevatorId, state.playbackTime);
    const currentText = plan.current
      ? `현재 ${plan.current.call.scheduledFloor}층`
      : plan.next
        ? `다음 ${plan.next.call.scheduledFloor}층`
        : "대기";
    const timeText = plan.current
      ? `${formatSimTime(plan.current.pickupTime)} 정차`
      : plan.next
        ? `${formatSimTime(plan.next.pickupTime)} 예정`
        : "추가 정차 없음";
    return `
      <article class="elevator-policy-card">
        <div>
          <strong>E${elevatorId}</strong>
          <span>${escapeHtml(profile.label)}</span>
        </div>
        <p>${formatFloorList(profile.floors)}</p>
        <b>${currentText}</b>
        <small>${timeText}</small>
      </article>
    `;
  }).join("");
}

function renderMetrics() {
  const summary = state.summary || {};
  const periods = state.periodSummaries || [];
  // 시간대(30분)별 소요시간(makespan)의 총합.
  const totalPeriodDuration = periods.reduce((sum, item) => sum + item.durationMinutes, 0);
  const dailyAverageDuration = periods.length ? totalPeriodDuration / periods.length : 0;
  const metrics = [
    ["정차 스케줄", formatInteger(summary.calls || 0)],
    ["학생 이동", formatInteger(summary.passengers || 0)],
    ["평균 대기", `${formatNumber((summary.averageWait || 0) * 60)}초`],
    ["최대 대기", `${formatNumber((summary.maxWait || 0) * 60)}초`],
    ["정차 총 시간", `${formatNumber(summary.totalStopSeconds || 0)}초`],
    ["소요시간 총합", `${formatNumber(totalPeriodDuration * 60)}초`],
    ["하루 평균 소요", `${formatNumber(dailyAverageDuration * 60)}초`],
  ];
  els.metricsGrid.innerHTML = metrics
    .map(([label, value]) => `<article class="metric"><span>${label}</span><strong>${value}</strong></article>`)
    .join("");
}

function renderBuilding() {
  const config = getConfig();
  const periodKey = periodKeyForTime(state.playbackTime);
  const selected = getSelectedAssignment();
  const waitingByFloor = getWaitingByFloor(state.playbackTime);
  els.buildingGrid.style.setProperty("--elevator-count", config.elevatorCount);
  els.buildingGrid.style.setProperty("--grid-columns", config.elevatorCount + 2);
  els.buildingGrid.innerHTML = "";

  for (let floor = config.totalFloors; floor >= config.minFloor; floor -= 1) {
    els.buildingGrid.appendChild(cell("floor-cell", `${floor}F`));

    for (let elevatorId = 1; elevatorId <= config.elevatorCount; elevatorId += 1) {
      const snapshot = elevatorSnapshot(elevatorId, state.playbackTime, config);
      const profile = getElevatorProfile(elevatorId, config, periodKey);
      const plan = getElevatorPlan(elevatorId, state.playbackTime);
      const shaft = cell("shaft-cell");
      if (!floorIsAllowed(profile, floor)) shaft.classList.add("out-of-service");
      if (selected?.call.origin === floor) shaft.classList.add("highlight-origin");
      if (selected?.call.destination === floor) shaft.classList.add("highlight-destination");
      if (
        plan.current?.call.scheduledFloor === floor ||
        (!plan.current && plan.next?.call.scheduledFloor === floor)
      ) {
        shaft.classList.add("scheduled-stop");
      }

      if (Math.round(snapshot.floor) === floor) {
        const car = document.createElement("div");
        car.className = `elevator-car ${snapshot.status}`;
        car.textContent = `E${elevatorId}`;
        car.title = `${formatNumber(snapshot.floor)}층 · ${snapshot.status}`;
        shaft.appendChild(car);
      }
      els.buildingGrid.appendChild(shaft);
    }

    const waiting = waitingByFloor.get(floor) || 0;
    els.buildingGrid.appendChild(cell("waiting-cell", waiting ? `대기 ${waiting}명` : ""));
  }
}

function cell(className, text = "") {
  const element = document.createElement("div");
  element.className = className;
  element.textContent = text;
  return element;
}

function elevatorSnapshot(elevatorId, time, config) {
  const assignments = state.assignmentsByElevator.get(elevatorId) || [];
  let lastFloor = config.lobbyFloor;

  for (const assignment of assignments) {
    if (time < assignment.startMoveTime) {
      return { floor: lastFloor, status: "idle" };
    }
    if (time <= assignment.pickupTime) {
      return {
        floor: interpolateFloor(
          assignment.startFloor,
          assignment.call.origin,
          assignment.startMoveTime,
          assignment.pickupTime,
          time,
        ),
        status: "moving",
      };
    }
    if (time <= assignment.pickupEndTime) {
      return { floor: assignment.call.origin, status: "boarding" };
    }
    if (time <= assignment.dropoffStartTime) {
      return {
        floor: interpolateFloor(
          assignment.call.origin,
          assignment.call.destination,
          assignment.pickupEndTime,
          assignment.dropoffStartTime,
          time,
        ),
        status: "moving",
      };
    }
    if (time <= assignment.dropoffTime) {
      return { floor: assignment.call.destination, status: "exiting" };
    }
    lastFloor = assignment.call.destination;
  }

  return { floor: lastFloor, status: "idle" };
}

function getElevatorPlan(elevatorId, time) {
  const assignments = state.assignmentsByElevator.get(elevatorId) || [];
  const current =
    assignments.find((assignment) => time >= assignment.startMoveTime && time <= assignment.dropoffTime) || null;
  const next =
    assignments.find((assignment) => assignment.startMoveTime > time) || null;
  return { current, next };
}

function formatFloorList(floors) {
  if (!floors.length) return "-";
  const sorted = [...floors].sort((a, b) => a - b);
  const ranges = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let index = 1; index < sorted.length; index += 1) {
    const floor = sorted[index];
    if (floor === prev + 1) {
      prev = floor;
      continue;
    }
    ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = floor;
    prev = floor;
  }
  ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
  return ranges.join(", ");
}

function interpolateFloor(from, to, start, end, time) {
  if (end <= start) return to;
  const ratio = clamp((time - start) / (end - start), 0, 1);
  return from + (to - from) * ratio;
}

function getWaitingByFloor(time) {
  const waitingByFloor = new Map();
  for (const assignment of state.assignments) {
    if (time < assignment.call.firstArrivalTime || time > assignment.pickupTime) continue;
    const arrived = assignment.call.arrivalTimes.filter((arrival) => arrival <= time).length;
    if (!arrived) continue;
    waitingByFloor.set(
      assignment.call.origin,
      (waitingByFloor.get(assignment.call.origin) || 0) + arrived,
    );
  }
  return waitingByFloor;
}

function renderSelectedDetail() {
  const selected = getSelectedAssignment();
  if (!selected) {
    els.selectedBadge.textContent = "-";
    els.selectedDetail.innerHTML = `<div class="empty-state">선택된 호출이 없습니다.</div>`;
    return;
  }

  const call = selected.call;
  const maxSeconds = maxStopServiceSeconds(getConfig().stopService);
  els.selectedBadge.textContent = `E${selected.elevatorId}`;
  const direction = call.kind === "before_class" ? "수업 시작" : "수업 종료";
  const dots = call.students
    .map(
      (student) =>
        `<span class="student-dot" title="${escapeHtml(student.studentLabel)} · ${formatSimTime(student.requestTime)}"></span>`,
    )
    .join("");
  const studentList = call.students
    .map(
      (student) => `
        <span class="student-pill">
          ${escapeHtml(student.studentLabel)}
          <b>${formatSimTime(student.requestTime)}</b>
        </span>
      `,
    )
    .join("");

  els.selectedDetail.innerHTML = `
    <div class="detail-kv">
      ${kv("학수번호", call.courseNo)}
      ${kv("강의실", `${call.classroom} · ${call.floor}층`)}
      ${kv("흐름", `${direction} · ${call.origin}층 → ${call.destination}층`)}
      ${kv("정차층", `${call.scheduledFloor}층 · E${selected.elevatorId}`)}
      ${kv("탑승 학생", `${call.passengers}명`)}
      ${kv("호출 시각", formatSimTime(call.requestTime))}
      ${kv("평균 대기", `${formatNumber(selected.waitMinutes * 60)}초`)}
      ${call.kind === "after_class" ? kv("재탑승 일치", `${call.returnMatches}/${call.passengers}명`) : ""}
    </div>
    <div class="student-stream">
      <h2>개별 도착 학생</h2>
      <div class="student-dots">${dots}</div>
      <div class="student-list">${studentList}</div>
      <p class="panel-header-note">${formatSimTime(call.firstArrivalTime)} - ${formatSimTime(call.lastArrivalTime)}</p>
    </div>
    <div class="service-bars">
      <h2>정차 난수</h2>
      ${serviceBar("탑승 정차", selected.pickupService.totalSeconds, maxSeconds)}
      ${serviceBar("하차 정차", selected.dropoffService.totalSeconds, maxSeconds)}
    </div>
  `;
}

function maxStopServiceSeconds(service) {
  const ranges = service || DEFAULT_STOP_SERVICE;
  return (
    ranges.deceleration.max +
    ranges.doorOpen +
    ranges.transfer.max +
    ranges.doorClose.max +
    ranges.reacceleration.max
  );
}

function kv(label, value) {
  return `<div class="kv-item"><span>${label}</span><strong>${escapeHtml(String(value))}</strong></div>`;
}

function serviceBar(label, seconds, maxSeconds = 17) {
  const width = clamp((seconds / (maxSeconds || 17)) * 100, 0, 100);
  return `
    <div class="service-bar">
      <span>${label}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
      <strong>${formatNumber(seconds)}초</strong>
    </div>
  `;
}

function renderLectureTable() {
  const query = els.courseSearch.value.trim().toLowerCase();
  const rows = state.demandRows
    .filter((row) => {
      if (!query) return true;
      return `${row.courseNo} ${row.classroom}`.toLowerCase().includes(query);
    })
    .sort((a, b) => a.start - b.start || b.classStudents - a.classStudents)
    .slice(0, 120);

  els.lectureTableBody.innerHTML =
    rows
      .map(
        (row) => `
      <tr>
        <td>${escapeHtml(row.courseNo)}</td>
        <td>${escapeHtml(row.classroom)} · ${row.floor}층</td>
        <td>${formatClock(row.start)}-${formatClock(row.end)}</td>
        <td>${row.classStudents}명 · FIFO 큐</td>
      </tr>
    `,
      )
      .join("") || `<tr><td colspan="4">표시할 강의가 없습니다.</td></tr>`;
}

function renderAssignmentTable() {
  els.assignmentCount.textContent = `${formatInteger(state.assignments.length)}건`;
  els.assignmentTableBody.innerHTML =
    state.assignments
      .map((assignment) => {
        const call = assignment.call;
        const kind = call.kind === "before_class" ? "상행" : "하행";
        return `
          <tr data-id="${assignment.id}">
            <td>${kind} ${call.scheduledFloor}층</td>
            <td>${formatSimTime(call.requestTime)}</td>
            <td>${escapeHtml(call.classroom)} · ${call.origin}→${call.destination}층</td>
            <td>${call.passengers}명</td>
            <td>E${assignment.elevatorId}</td>
            <td>${formatNumber(assignment.waitMinutes * 60)}초</td>
          </tr>
        `;
      })
      .join("") || `<tr><td colspan="6">배정된 호출이 없습니다.</td></tr>`;

  els.assignmentTableBody.querySelectorAll("tr[data-id]").forEach((row) => {
    row.addEventListener("click", () => {
      selectAssignment(Number(row.dataset.id));
    });
  });
  highlightAssignmentRow();
}

function selectAssignment(id) {
  state.selectedId = id;
  const selected = getSelectedAssignment();
  if (selected) {
    state.playbackTime = selected.requestTime;
    updateTimelineBounds();
  }
  renderLiveViews();
}

function highlightAssignmentRow() {
  els.assignmentTableBody.querySelectorAll("tr[data-id]").forEach((row) => {
    row.classList.toggle("selected", Number(row.dataset.id) === state.selectedId);
  });
}

function getSelectedAssignment() {
  return state.assignments.find((item) => item.id === state.selectedId) || state.assignments[0] || null;
}

function startPlayback() {
  if (state.playing || !state.assignments.length) return;
  state.playing = true;
  state.playTimer = window.setInterval(() => {
    state.playbackTime += 1;
    if (state.playbackTime > state.timeMax) state.playbackTime = state.timeMin;
    renderLiveViews();
  }, 260);
}

function stopPlayback() {
  state.playing = false;
  if (state.playTimer) {
    window.clearInterval(state.playTimer);
    state.playTimer = null;
  }
}

function showEmptyState(message) {
  els.metricsGrid.innerHTML = `<article class="metric"><span>상태</span><strong>CSV 필요</strong></article>`;
  els.selectedDetail.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return function next() {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function randFloat(rng, min, max) {
  return min + rng() * (max - min);
}

function randInt(rng, min, max) {
  return Math.floor(randFloat(rng, min, max + 1));
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatSimTime(minutes) {
  const total = Math.round(minutes);
  const dayIndex = Math.max(0, Math.floor(total / MINUTES_PER_DAY));
  return `${DAYS[dayIndex] || `D+${dayIndex}`} ${formatClock(total)}`;
}

function formatClock(minutes) {
  const minuteOfDay = ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  }).format(value);
}

function formatInteger(value) {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
