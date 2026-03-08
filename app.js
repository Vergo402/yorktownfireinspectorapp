// ═══════════════════════════════════════════════════════════════
// YORKTOWN FIRE INSPECTION APP — app.js
// Firebase Firestore backend · Real-time sync across all devices
// ═══════════════════════════════════════════════════════════════

// ── Occupancy Labels & Icons ─────────────────────────────────
const OL = {
  'A-1':'Assembly A-1','A-2':'Assembly A-2','A-3':'Assembly A-3',
  'A-4':'Assembly A-4','A-5':'Assembly A-5',
  'B':'Business (B)','E':'Educational (E)',
  'F-1':'Factory F-1','F-2':'Factory F-2',
  'H-1':'High Hazard H-1','H-2':'High Hazard H-2',
  'H-3':'High Hazard H-3','H-4':'High Hazard H-4','H-5':'High Hazard H-5',
  'I-1':'Institutional I-1','I-2':'Institutional I-2',
  'I-3':'Institutional I-3','I-4':'Institutional I-4',
  'M':'Mercantile (M)','R-1':'Residential R-1','R-2':'Residential R-2',
  'R-3':'Residential R-3','R-4':'Residential R-4',
  'S-1':'Storage S-1','S-2':'Storage S-2','U':'Utility (U)'
};
const OI = {
  'A-1':'🎭','A-2':'🍽️','A-3':'⛪','A-4':'🏟️','A-5':'🏟️',
  'B':'🏢','E':'🏫','F-1':'🏭','F-2':'🔧',
  'H-1':'💥','H-2':'💥','H-3':'⚗️','H-4':'☣️','H-5':'⚗️',
  'I-1':'🏥','I-2':'🏥','I-3':'🔒','I-4':'👶',
  'M':'🛒','R-1':'🏨','R-2':'🏠','R-3':'🏡','R-4':'🏠',
  'S-1':'📦','S-2':'📦','U':'🔧'
};

// ── In-memory state (loaded from Firestore) ──────────────────
let S = {
  businesses: [],
  inspections: [],
  violations: [],
  settings: {
    inspectorName:'', inspectorEmail:'', inspectorPhone:'', inspectorBadge:'',
    inspectorCert:'', deptEmail:'building@yorktownny.gov',
    deptName:'Town of Yorktown Building Dept.',
    deptPhone:'(914) 962-5722',
    deptAddr:'363 Underhill Ave, Yorktown Heights, NY 10598',
    defaultDeadlineDays: 30,
    defaultCity:'Yorktown Heights', defaultZip:'10598'
  },
  curInsp: null,
  curBiz: null,
  editBizId: null,
  violFilter: 'all',
  _bizOccFilter: ''
};
let _unsubscribers = [];

// ═══════════════════════════════════════════════════════════════
// FIREBASE HELPERS
// ═══════════════════════════════════════════════════════════════
function db() { return window._db; }
function uid() { return window._uid; }
function FB() { return window._FB; }

function userCol(col) {
  return FB().collection(db(), `users/${uid()}/${col}`);
}
function userDoc(col, id) {
  return FB().doc(db(), `users/${uid()}/${col}/${id}`);
}

function showSync(state = 'saved') {
  const el = document.getElementById('sync-status');
  if (!el) return;
  el.className = 'show ' + (state === 'saving' ? 'saving' : state === 'error' ? 'error' : '');
  el.textContent = state === 'saving' ? '↑ Saving…' : state === 'error' ? '✗ Sync error' : '✓ Synced';
  clearTimeout(el._t);
  if (state !== 'saving') el._t = setTimeout(() => el.classList.remove('show'), 3000);
}

// ── Save a single document ───────────────────────────────────
async function saveDoc(collection, id, data) {
  showSync('saving');
  try {
    await FB().setDoc(userDoc(collection, id), { ...data, _updatedAt: FB().serverTimestamp() });
    showSync('saved');
  } catch (e) {
    console.error('Save error', e);
    showSync('error');
    throw e;
  }
}

// ── Delete a document ────────────────────────────────────────
async function deleteDocument(collection, id) {
  showSync('saving');
  try {
    await FB().deleteDoc(userDoc(collection, id));
    showSync('saved');
  } catch (e) {
    showSync('error');
    throw e;
  }
}

// ── Real-time listener helper ────────────────────────────────
function listenCol(colName, callback) {
  const unsub = FB().onSnapshot(userCol(colName), snap => {
    const docs = [];
    snap.forEach(d => docs.push({ id: d.id, ...d.data() }));
    callback(docs);
  }, err => {
    console.error('Listener error', colName, err);
  });
  _unsubscribers.push(unsub);
  return unsub;
}

// ═══════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════
let _authMode = 'signin';

function switchTab(mode) {
  _authMode = mode;
  document.getElementById('tab-signin').classList.toggle('active', mode === 'signin');
  document.getElementById('tab-signup').classList.toggle('active', mode === 'signup');
  document.getElementById('signup-extra').classList.toggle('hidden', mode === 'signin');
  document.getElementById('auth-btn').textContent = mode === 'signin' ? 'Sign In' : 'Create Account';
}

function showAuthError(msg) {
  const el = document.getElementById('login-error');
  document.getElementById('login-error-msg').textContent = msg;
  el.classList.remove('hidden');
}

async function doAuth() {
  const email = document.getElementById('auth-email').value.trim();
  const pw    = document.getElementById('auth-pw').value;
  const btn   = document.getElementById('auth-btn');
  if (!email || !pw) { showAuthError('Please enter email and password.'); return; }
  document.getElementById('login-error').classList.add('hidden');
  btn.textContent = '…';
  btn.disabled = true;
  try {
    if (_authMode === 'signup') {
      const pw2 = document.getElementById('auth-pw2').value;
      if (pw !== pw2) {
        showAuthError('Passwords do not match.');
        btn.textContent = 'Create Account'; btn.disabled = false; return;
      }
      await window._createUser(email, pw);
    } else {
      await window._signIn(email, pw);
    }
    // onAuthStateChanged in index.html handles the rest
  } catch (e) {
    const msgs = {
      'auth/user-not-found':     'No account with that email. Register first.',
      'auth/wrong-password':     'Incorrect password.',
      'auth/invalid-email':      'Invalid email address.',
      'auth/email-already-in-use':'Email already registered. Sign in instead.',
      'auth/weak-password':      'Password must be at least 6 characters.',
      'auth/invalid-credential': 'Invalid email or password.',
    };
    showAuthError(msgs[e.code] || e.message);
    btn.textContent = _authMode === 'signin' ? 'Sign In' : 'Create Account';
    btn.disabled = false;
  }
}

async function doSignOut() {
  _unsubscribers.forEach(u => u());
  _unsubscribers = [];
  await window._signOut();
}

// Enter key on password field
document.getElementById('auth-pw')?.addEventListener('keydown', e => { if (e.key === 'Enter') doAuth(); });
document.getElementById('auth-email')?.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('auth-pw').focus(); });

// ═══════════════════════════════════════════════════════════════
// APP START — called after login
// ═══════════════════════════════════════════════════════════════
window.appStart = function() {
  document.getElementById('settings-email').textContent = window._userEmail || '';

  // Set up real-time listeners
  listenCol('businesses', docs => {
    S.businesses = docs;
    renderBizList();
    renderDash();
  });
  listenCol('inspections', docs => {
    S.inspections = docs;
    renderDash();
    // Refresh active inspection if open, re-attaching static sections
    if (S.curInsp) {
      const updated = docs.find(i => i.id === S.curInsp.id);
      if (updated) {
        S.curInsp = { ...updated, sections: sectionsForOcc(updated.occupancy) };
      }
    }
  });
  listenCol('violations', docs => {
    S.violations = docs;
    renderViols();
    renderDash();
    updateViolDot();
  });

  // Load settings (one-time)
  FB().getDoc(userDoc('meta', 'settings')).then(snap => {
    if (snap.exists()) {
      Object.assign(S.settings, snap.data());
      loadSettings();
    }
  });

  // Restore theme
  try {
    const t = localStorage.getItem('ytTheme');
    if (t) { document.documentElement.setAttribute('data-theme', t); document.getElementById('dark-btn').textContent = t === 'dark' ? '☀️' : '🌙'; }
  } catch(e) {}

  showScreen('dashboard');
};

// ═══════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nb').forEach(b => b.classList.remove('active'));
  const scr = document.getElementById('screen-' + name);
  const nav = document.getElementById('nav-' + name);
  if (scr) scr.classList.add('active');
  if (nav) nav.classList.add('active');
  if (name === 'settings') loadSettings();
  window.scrollTo(0, 0);
}

function toggleDark() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
  document.getElementById('dark-btn').textContent = isDark ? '🌙' : '☀️';
  try { localStorage.setItem('ytTheme', isDark ? 'light' : 'dark'); } catch(e) {}
}

function updateViolDot() {
  const open = S.violations.filter(v => v.status === 'open').length;
  const dot = document.getElementById('viol-dot');
  if (dot) { dot.textContent = open; dot.classList.toggle('hidden', open === 0); }
}

// ═══════════════════════════════════════════════════════════════
// CHECKLIST DATA
// (Full NYS / Yorktown / IBC / NFPA checklist — all occupancies)
// ═══════════════════════════════════════════════════════════════
const ALL_SECTIONS = [
  {id:'egress', title:'🚪 Means of Egress', items:[
    {id:'eg1',label:'All required exit doors operable, unobstructed, and swing in direction of egress travel',code:'IBC §1010.1.9 | NFPA 101 §7.2.1 | 19 NYCRR 1225',critical:true},
    {id:'eg2',label:'Minimum exit door clear width: 32" (36" in schools/hospitals)',code:'IBC §1010.1.1',critical:true},
    {id:'eg3',label:'Panic/fire exit hardware where required (Assembly, E, H occupancies ≥50 persons)',code:'IBC §1010.1.10 | NFPA 101 §7.2.1.7',critical:true},
    {id:'eg4',label:'All exit signs illuminated; no burned-out lamps',code:'IBC §1013 | NFPA 101 §7.10',critical:true},
    {id:'eg5',label:'Emergency lighting operational – min. 1 ft-candle at floor level; tested annually',code:'IBC §1008 | NFPA 101 §7.9',critical:true},
    {id:'eg6',label:'Exit access corridors not used for storage; completely unobstructed',code:'IBC §1005 | NFPA 101 §7.1.10',critical:true},
    {id:'eg7',label:'Minimum number of exits provided per occupant load and occupancy type',code:'IBC §1006',critical:true},
    {id:'eg8',label:'Exit stairs free of obstructions; handrails present, continuous, and secure',code:'IBC §1011 | NFPA 101 §7.2.2',critical:false},
    {id:'eg9',label:'Stairwell doors self-closing and positive-latching; not propped open',code:'IBC §716 | NFPA 101 §7.2.2.5',critical:false},
    {id:'eg10',label:'Occupant load sign posted at each assembly/public space',code:'IBC §1004.9',critical:false},
    {id:'eg11',label:'Exit discharge path to public way accessible and unobstructed',code:'IBC §1028',critical:true},
    {id:'eg12',label:'Travel distance to exits does not exceed maximum for this occupancy',code:'IBC §1017',critical:false},
    {id:'eg13',label:'Accessible means of egress provided per ADA / IBC §1009',code:'IBC §1009',critical:false},
  ]},
  {id:'fire_alarm', title:'🔔 Fire Alarm System', items:[
    {id:'fa1',label:'Fire alarm system installed where required for this occupancy type',code:'IBC §907 | NFPA 72 | 19 NYCRR 1225',critical:true},
    {id:'fa2',label:'Annual fire alarm inspection/test certificate on file (within 12 months)',code:'NFPA 72 §14 | 19 NYCRR 1225',critical:true},
    {id:'fa3',label:'Manual pull stations accessible, unobstructed, and within 5 ft of exit doors',code:'NFPA 72 §17.14',critical:true},
    {id:'fa4',label:'Audible and visual alarm devices functional throughout building',code:'NFPA 72 §18 | IBC §907.5.2',critical:true},
    {id:'fa5',label:'Fire alarm control panel accessible; no active trouble or supervisory alarms',code:'NFPA 72 §10',critical:true},
    {id:'fa6',label:'Smoke detectors installed in all code-required areas; no tampering',code:'NFPA 72 §17.7 | IBC §907',critical:true},
    {id:'fa7',label:'Carbon monoxide detectors installed where required (fuel-burning equip / attached garage)',code:'NFPA 720 | NYS Exec. Law §378',critical:true},
    {id:'fa8',label:'Central station monitoring contract current and documented on-site',code:'NFPA 72 §26',critical:false},
    {id:'fa9',label:'Battery backup tested; adequate 24-hr standby capacity confirmed',code:'NFPA 72 §10.6',critical:false},
    {id:'fa10',label:'Duct smoke detectors present in HVAC systems where required (>2,000 CFM)',code:'IBC §907.3 | NFPA 72 §17.7.5',critical:false},
  ]},
  {id:'sprinkler', title:'💧 Fire Suppression / Sprinkler System', items:[
    {id:'sp1',label:'Automatic sprinkler system installed where required by occupancy/area/height',code:'IBC §903 | NFPA 13 | 19 NYCRR 1225',critical:true},
    {id:'sp2',label:'Annual sprinkler inspection/test certificate on file (within 12 months)',code:'NFPA 25 §5.2 | 19 NYCRR 1225',critical:true},
    {id:'sp3',label:'18" minimum clearance maintained below all sprinkler heads',code:'NFPA 13 §8.5.5',critical:true},
    {id:'sp4',label:'No painted, corroded, loaded, or physically damaged sprinkler heads',code:'NFPA 25 §5.2.1',critical:true},
    {id:'sp5',label:'Spare sprinkler heads (min. 6) and listed wrench available on-site in cabinet',code:'NFPA 13 §6.2.9',critical:false},
    {id:'sp6',label:'Main sprinkler shutoff valve locked open, tagged, and supervised',code:'NFPA 25 §13.3 | NFPA 13 §8.15',critical:true},
    {id:'sp7',label:'Water flow alarm test and tamper switch test within past 12 months; documented',code:'NFPA 25 §5.3',critical:false},
    {id:'sp8',label:'Inspector test valve accessible, labeled, and in working order',code:'NFPA 25 §5.2.5',critical:false},
    {id:'sp9',label:'FDC (Fire Department Connection) unobstructed, capped, and accessible',code:'IFC §912 | NFPA 13 §6.8',critical:true},
    {id:'sp10',label:'Sprinkler heads not obstructed by partitions, shelving, or equipment',code:'NFPA 13 §8.5 | NFPA 25',critical:true},
  ]},
  {id:'fire_ext', title:'🧯 Portable Fire Extinguishers', items:[
    {id:'fe1',label:'Fire extinguishers mounted, visible, and accessible (max 30" above floor to handle)',code:'NFPA 10 §6.1.3 | 19 NYCRR 1225',critical:true},
    {id:'fe2',label:'Annual inspection tag current within 12 months; 6-year maintenance current',code:'NFPA 10 §7.3',critical:true},
    {id:'fe3',label:'Correct type and rating for hazard class (A, B, C, K as applicable)',code:'NFPA 10 §5',critical:true},
    {id:'fe4',label:'Travel distance: ≤75 ft for Class A; ≤50 ft for Class B; ≤30 ft for Class K',code:'NFPA 10 §6.1',critical:false},
    {id:'fe5',label:'Pressure gauge needle in green/operable zone on all extinguishers',code:'NFPA 10 §7.2',critical:true},
    {id:'fe6',label:'No obstructions blocking access; tamper seal intact; pull pin present',code:'NFPA 10 §6.1.3.8',critical:true},
  ]},
  {id:'electrical', title:'⚡ Electrical Safety', items:[
    {id:'el1',label:'Electrical panels accessible, labeled, and 36" clearance in front maintained',code:'NFPA 70 §110.26 | IFC §605.3',critical:true},
    {id:'el2',label:'No open junction boxes, missing covers, or exposed wiring',code:'NFPA 70 §314.28 | IFC §605',critical:true},
    {id:'el3',label:'Extension cords not used as permanent wiring; no daisy-chaining power strips',code:'NFPA 70 §400.8 | IFC §605.5',critical:true},
    {id:'el4',label:'No overloaded outlets or multi-plug adapters without surge protection',code:'IFC §605.4',critical:true},
    {id:'el5',label:'GFCI protection present in all wet/damp locations',code:'NFPA 70 §210.8',critical:false},
    {id:'el6',label:'No combustible materials within 3 ft of panels or in electrical rooms',code:'NFPA 70 §110.26 | IFC §605.3',critical:true},
    {id:'el7',label:'Generator (if present): properly bonded, ventilated, transfer switch installed',code:'NFPA 70 §702 | IFC §604',critical:false},
  ]},
  {id:'hazmat', title:'☣️ Hazardous Materials & Storage', items:[
    {id:'hm1',label:'Flammable/combustible liquids stored in approved FM/UL-listed containers',code:'NFPA 30 | IFC §5704',critical:true},
    {id:'hm2',label:'Storage quantities within IFC exempt amounts for this occupancy',code:'IBC §414 | IFC Table 5003.1.1',critical:true},
    {id:'hm3',label:'SDS accessible for all hazardous materials on-site',code:'OSHA 29 CFR 1910.1200 | IFC §407',critical:false},
    {id:'hm4',label:'Hazardous materials stored away from ignition sources and heat-producing equipment',code:'NFPA 30 §6.4',critical:true},
    {id:'hm5',label:'Proper mechanical ventilation in all hazardous material storage areas',code:'IFC §5704.3.3',critical:true},
  ]},
  {id:'general', title:'🏗️ General Fire Safety – Yorktown Requirements', items:[
    {id:'gn1',label:'Knox Box installed at main entrance and accessible to fire dept.',code:'Yorktown Ch.130 §130-4 | IFC §506',critical:true},
    {id:'gn2',label:'Address numbers clearly visible from street – min. 4" height, contrasting color',code:'Yorktown Ch.130 | IFC §505.1',critical:true},
    {id:'gn3',label:'Certificate of Occupancy posted or available; consistent with current use',code:'Yorktown Ch.130 | IBC §111',critical:false},
    {id:'gn4',label:'No-smoking signs posted at all required locations per NYS Public Health Law',code:'19 NYCRR 1225 | NY PHL §1399-n',critical:false},
    {id:'gn5',label:'Interior finish materials comply with flame spread/smoke development index',code:'IBC §803 | NFPA 101 §10.2',critical:false},
    {id:'gn6',label:'Combustible materials not stored within 10 ft of building or heat sources outdoors',code:'IFC §315 | 19 NYCRR 1225',critical:true},
    {id:'gn7',label:'Fire lane markings maintained; no unauthorized vehicles blocking FD access',code:'IFC §503 | Yorktown Ch.130',critical:true},
    {id:'gn8',label:'Emergency Action/Response Plan posted; all occupants trained annually',code:'IFC §404 | 29 CFR 1910.38',critical:false},
    {id:'gn9',label:'Fire doors rated, self-closing, positive-latching; not propped or chocked',code:'NFPA 80 | IBC §716.5',critical:true},
    {id:'gn10',label:'Roof access maintained for firefighting operations (if applicable)',code:'IFC §504.3',critical:false},
    {id:'gn11',label:'Annual fire inspection report on file; prior violations abated or documented',code:'19 NYCRR 1225 | Yorktown Ch.130',critical:false},
  ]},
  {id:'liion', title:'🔋 Lithium-Ion Batteries & Energy Storage Systems', items:[
    {id:'li1',label:'Li-ion battery inventory documented (quantity, location, watt-hour rating)',code:'IFC §1207.1 | NFPA 855 §4.1',critical:true},
    {id:'li2',label:'Total aggregate energy capacity does not exceed IFC §1207 thresholds without permits',code:'IFC §1207.2 | NFPA 855 §4.3',critical:true},
    {id:'li3',label:'Charging conducted only with manufacturer-listed/approved chargers',code:'IFC §1207.4 | NFPA 855 §4.5 | UL 2580',critical:true},
    {id:'li4',label:'Charging areas designated and free of combustibles within 3 ft',code:'IFC §1207.4.2 | NFPA 855',critical:true},
    {id:'li5',label:'Batteries not charged overnight in unattended areas unless in listed cabinet',code:'IFC §1207.4 | NFPA 855 §4.5',critical:true},
    {id:'li6',label:'Charging stations installed per manufacturer specs; no makeshift adapters',code:'IFC §1207.4 | NFPA 70 §625',critical:true},
    {id:'li7',label:'Charging circuits protected by appropriately rated overcurrent protection',code:'NFPA 70 §625.22 | IFC §1207.4',critical:false},
    {id:'li8',label:'EV/e-bike charging in parking structures: ventilation per IFC §1207.10',code:'IFC §1207.10 | NFPA 88A',critical:true},
    {id:'li9',label:'Batteries stored in cool, dry location away from heat sources (32–77°F preferred)',code:'IFC §1207.3 | NFPA 855 §4.4',critical:true},
    {id:'li10',label:'Batteries not stored in corridors, stairwells, exit pathways, or means of egress',code:'IFC §1207.3.2 | IBC §1005',critical:true},
    {id:'li11',label:'Damaged, swollen, or recalled battery units removed from service',code:'IFC §1207.3 | NFPA 855 §4.4.3',critical:true},
    {id:'li12',label:'Large-format/rack batteries in dedicated 1-hour fire-rated room',code:'IFC §1207.5 | NFPA 855 §5.3',critical:true},
    {id:'li14',label:'Commercial ESS listed per UL 9540; installation permit on file',code:'IFC §1207.6 | NFPA 855 §5 | UL 9540',critical:true},
    {id:'li15',label:'ESS thermal runaway detection/suppression system operational',code:'IFC §1207.7 | NFPA 855 §6.3',critical:true},
    {id:'li16',label:'ESS room smoke/heat detection connected to fire alarm system',code:'IFC §1207.7.2 | NFPA 72 | NFPA 855',critical:true},
    {id:'li17',label:'ESS automatic disconnect/shutdown interlock functional',code:'IFC §1207.7.3 | NFPA 855 §6.4',critical:true},
    {id:'li20',label:'Emergency response info (battery type, quantity, SDS) available for fire dept.',code:'IFC §1207.8 | IFC §407.6',critical:true},
    {id:'li22',label:'E-bikes/scooters not charged inside corridors or stairwells',code:'IFC §1207.10 | 19 NYCRR 1225',critical:true},
    {id:'li23',label:'E-bike/scooter storage separated from occupied spaces; not blocking egress',code:'IFC §1207.10.2',critical:true},
    {id:'li24',label:'Recalled or counterfeit batteries/chargers not in use (check UL/ETL marks)',code:'CPSC Recall List | IFC §1207.4 | NFPA 855',critical:true},
  ]},
  // ── Occupancy-Specific ────────────────────────────────────
  {id:'occ-a1',title:'🎭 Assembly A-1 – Theaters & Performing Arts',applicableOcc:['A-1'],items:[
    {id:'a1_1',label:'Seating capacity does not exceed posted/approved occupant load',code:'IBC §1004.9 | NFPA 101 §12.7.9',critical:true},
    {id:'a1_2',label:'Stage area drencher/curtain sprinkler system operational',code:'IBC §410.6 | NFPA 13 §17.3',critical:true},
    {id:'a1_3',label:'Projection room construction and equipment per code',code:'IBC §409 | NFPA 40',critical:false},
    {id:'a1_4',label:'Aisle lighting operational; minimum 0.2 fc at floor level',code:'IBC §1028.8 | NFPA 101 §12.2.8',critical:true},
    {id:'a1_5',label:'Cross-aisles and side aisles unobstructed per seating arrangement',code:'IBC §1029.9',critical:false},
    {id:'a1_6',label:'Proscenium wall and fire curtain inspected annually',code:'IBC §410.3 | NFPA 101 §12.4.5',critical:false},
  ]},
  {id:'occ-a2',title:'🍽️ Assembly A-2 – Restaurants, Bars & Nightclubs',applicableOcc:['A-2'],items:[
    {id:'a2_1',label:'Commercial kitchen hood/suppression – current semi-annual inspection (NFPA 96)',code:'NFPA 96 §11 | IFC §904.12',critical:true},
    {id:'a2_2',label:'Grease filters cleaned per schedule; ducts and fans clean of buildup',code:'NFPA 96 §11.4',critical:true},
    {id:'a2_3',label:'Class K extinguisher within 30 ft of commercial cooking equipment',code:'NFPA 10 §5.5.4',critical:true},
    {id:'a2_4',label:'Occupant load does not exceed posted limit',code:'IBC §1004.9 | NFPA 101 §12.7.9',critical:true},
    {id:'a2_5',label:'Outdoor seating or tent structures comply with IFC §3103 and NFPA 102',code:'IFC §3103 | NFPA 102',critical:false},
    {id:'a2_6',label:'Bar/entertainment area: no blocked exits or overcrowding',code:'IBC §1005 | NFPA 101',critical:true},
    {id:'a2_7',label:'Gas appliances properly connected; no odor of gas; CO detectors operational',code:'NFPA 54 | IFC §604 | NYS Exec. Law §378',critical:true},
  ]},
  {id:'occ-a3',title:'⛪ Assembly A-3 – Worship, Recreation & Community',applicableOcc:['A-3'],items:[
    {id:'a3_1',label:'Occupant load not exceeded; crowd management staff if >1,000 persons',code:'IBC §1004.9 | IFC §403',critical:true},
    {id:'a3_2',label:'All decorations and drapes are flame-retardant or non-combustible',code:'IFC §806 | NFPA 101 §12.7.4',critical:false},
    {id:'a3_3',label:'Candles and open flame devices comply with IFC §308',code:'IFC §308',critical:false},
    {id:'a3_4',label:'Kitchen/food prep area (if present) inspected per NFPA 96',code:'NFPA 96 | IFC §904.12',critical:false},
  ]},
  {id:'occ-a4',title:'🏟️ Assembly A-4 – Indoor Arenas & Sports',applicableOcc:['A-4'],items:[
    {id:'a4_1',label:'Occupant load not exceeded; crowd management plan in place',code:'IFC §403 | IBC §1004.9',critical:true},
    {id:'a4_2',label:'Smoke exhaust/ventilation system operational for smoke control',code:'IBC §909 | NFPA 101 §12.3.11',critical:true},
    {id:'a4_3',label:'Concession stands with cooking: NFPA 96 semi-annual inspection current',code:'NFPA 96 | IFC §904.12',critical:false},
  ]},
  {id:'occ-a5',title:'🏟️ Assembly A-5 – Stadiums & Outdoor Venues',applicableOcc:['A-5'],items:[
    {id:'a5_1',label:'Temporary structures (tents, stages) permitted and inspected',code:'IFC §3103 | NFPA 102',critical:true},
    {id:'a5_2',label:'Emergency egress plan posted; crowd management staff deployed',code:'IFC §403 | IBC §1004.9',critical:true},
  ]},
  {id:'occ-b',title:'🏢 Business (Group B) – Offices, Banks, Higher Education',applicableOcc:['B'],items:[
    {id:'b1',label:'Corridors to exits clear; no furniture or storage obstructions',code:'IBC §1005 | NFPA 101 §38.2.5',critical:true},
    {id:'b2',label:'Adequate smoke detection coverage in all occupied office areas',code:'NFPA 72 §17 | IBC §907',critical:true},
    {id:'b3',label:'Server rooms and electrical rooms: appropriate suppression system installed',code:'IBC §904 | NFPA 75',critical:false},
    {id:'b4',label:'Break rooms: no unattended toaster ovens; microwave properly vented',code:'IFC §605.6',critical:false},
    {id:'b5',label:'Sprinkler system required if building >3 stories or >12,000 sq ft',code:'IBC §903.2.4 | 19 NYCRR 1225',critical:true},
  ]},
  {id:'occ-e',title:'🏫 Educational (Group E) – K-12 Schools & Daycares',applicableOcc:['E'],items:[
    {id:'e1',label:'Monthly fire drill log maintained and available for inspection',code:'19 NYCRR 1225 | Ed. Law §807',critical:true},
    {id:'e2',label:'Evacuation route maps posted in every classroom and common area',code:'NFPA 101 §14.7.7 | IFC §404',critical:true},
    {id:'e3',label:'Electronically locked perimeter doors: remote release tied to fire alarm',code:'IBC §1010.1.9.8 | NFPA 101 §14.2.2',critical:true},
    {id:'e4',label:'Science labs: hazmat within exempt quantities; eyewash stations functional',code:'IBC §428 | IFC §5001',critical:false},
    {id:'e5',label:'Stage/auditorium (if present) meets Group A sprinkler/egress requirements',code:'IBC §303 | NFPA 101 §14.3',critical:false},
    {id:'e6',label:'Annual fire inspection by NYS OFPC or designated inspector on file',code:'19 NYCRR 1225 | Ed. Law §807',critical:true},
    {id:'e7',label:'All exterior doors: hardware operable from inside without key during occupancy',code:'IBC §1010.1.9 | NFPA 101 §14.2.2',critical:true},
    {id:'e8',label:'Cafeteria kitchen (if present): NFPA 96 semi-annual inspection current',code:'NFPA 96 | IFC §904.12',critical:true},
  ]},
  {id:'occ-f1',title:'🏭 Factory / Auto Repair (F-1 / F-2)',applicableOcc:['F-1','F-2'],items:[
    {id:'f1_1',label:'Dust collection systems maintained, grounded, and bonded per NFPA 654',code:'NFPA 654 | IFC §2201',critical:true},
    {id:'f1_2',label:'Flammable liquid storage within IBC Table 307.1(1) exempt quantities',code:'IBC §307 | IFC §5704',critical:true},
    {id:'f1_3',label:'Hot work permit system in place; permits current',code:'IFC §3503 | NFPA 51B',critical:false},
    {id:'f1_4',label:'Production/work area aisle widths ≥ 3 ft maintained clear',code:'IFC §315 | NFPA 101 §40.2.5',critical:true},
    {id:'f1_5',label:'Spray booths/finishing operations per NFPA 33; ventilation operational',code:'NFPA 33 | IFC §2404',critical:true},
    {id:'f1_6',label:'Industrial ovens and furnaces maintained per NFPA 86',code:'NFPA 86 | IFC §2101',critical:false},
    {id:'f1_7',label:'Auto repair: flammable liquids properly drained and disposed; no open containers',code:'NFPA 30A | IFC §2303',critical:true},
    {id:'f1_8',label:'Auto repair: vehicle lifts – no fuel leaks; no combustible waste beneath',code:'NFPA 30A §4.3 | IFC §2305',critical:true},
    {id:'f1_9',label:'Auto repair: tire storage ≤ 5 ft height; fire separation from work area',code:'IFC §3404 | NFPA 30A',critical:false},
    {id:'f1_10',label:'Auto repair: parts washer is listed; solvent within type and quantity limits',code:'NFPA 30 | IFC §5706',critical:false},
    {id:'f1_11',label:'Storage areas separated from work areas with fire-rated construction',code:'IBC §508 | IFC §315',critical:false},
  ]},
  {id:'occ-h',title:'💥 High Hazard (Group H)',applicableOcc:['H-1','H-2','H-3','H-4','H-5'],items:[
    {id:'h1',label:'MAQ per IFC Table 5003.1.1 not exceeded',code:'IFC §5003 | IBC §307',critical:true},
    {id:'h2',label:'Hazardous material inventory/control plan current and on-site',code:'IFC §5001.5.2',critical:true},
    {id:'h3',label:'Exhaust ventilation operational and tested in all hazardous areas',code:'IFC §5004.3 | NFPA 91',critical:true},
    {id:'h4',label:'Spill control and secondary containment (110% of largest container) in place',code:'IFC §5004.2 | NFPA 30',critical:true},
    {id:'h5',label:'No-smoking / no open flame enforced; posted at all entry points',code:'IFC §5003.7.1',critical:true},
    {id:'h6',label:'Eyewash/safety shower within 10 seconds; tested weekly per ANSI Z358.1',code:'ANSI Z358.1 | OSHA 29 CFR 1910',critical:true},
    {id:'h7',label:'Incompatible materials segregated per NFPA 400 / SDS requirements',code:'NFPA 400 | IFC §5003.9.8',critical:true},
    {id:'h8',label:'H-1: Explosive quantity-distance separation per NFPA 495',code:'NFPA 495 | IFC §5604.1',critical:true},
    {id:'h9',label:'H-2: Deflagration venting per NFPA 68 installed and unobstructed',code:'NFPA 68 | IBC §414.5',critical:true},
    {id:'h10',label:'H-5: Gas monitoring systems operational and alarmed',code:'IFC §5004.9 | NFPA 72',critical:true},
  ]},
  {id:'occ-i1',title:'🏥 Institutional I-1 – Assisted Living',applicableOcc:['I-1'],items:[
    {id:'i1_1',label:'Full automatic sprinkler system throughout entire building',code:'IBC §903.2.6 | NFPA 13',critical:true},
    {id:'i1_2',label:'Full addressable fire alarm with voice evacuation operational',code:'IBC §907.2.6 | NFPA 72',critical:true},
    {id:'i1_3',label:'Fire and evacuation drills per NFPA 101 Ch.32 frequency requirements',code:'NFPA 101 §32.7.1 | 19 NYCRR 1225',critical:true},
    {id:'i1_4',label:'Smoke barriers and compartmentation maintained per NFPA 101 Ch.32',code:'NFPA 101 §32.3.7 | IBC §407',critical:true},
    {id:'i1_5',label:'Smoke detectors in all resident rooms, corridors, and common areas',code:'NFPA 72 | 19 NYCRR 1225',critical:true},
    {id:'i1_6',label:'Emergency generator tested monthly; covers all life safety loads',code:'NFPA 110 | IBC §2702',critical:true},
    {id:'i1_7',label:'Resident evacuation assistance plan current; staff trained on mobility-impaired evac.',code:'NFPA 101 §32.7 | 19 NYCRR 1225',critical:true},
  ]},
  {id:'occ-i2',title:'🏥 Institutional I-2 – Hospitals & Nursing Facilities',applicableOcc:['I-2'],items:[
    {id:'i2_1',label:'Full NFPA 13 sprinkler system operational throughout',code:'IBC §903.2.6 | NFPA 13',critical:true},
    {id:'i2_2',label:'Smoke and corridor compartmentation intact; no breaches',code:'IBC §407.4 | NFPA 101 §18.3.7',critical:true},
    {id:'i2_3',label:'Medical gas systems inspected and labeled per NFPA 99',code:'NFPA 99 §5 | IBC §428',critical:true},
    {id:'i2_4',label:'Emergency generator monthly test and annual load test documented',code:'NFPA 110 | NFPA 99',critical:true},
    {id:'i2_5',label:'Defend-in-place procedures documented; all staff trained',code:'NFPA 101 §18.7',critical:true},
    {id:'i2_6',label:'All fire door assemblies self-closing and positive-latching; no propping',code:'NFPA 80 | IBC §716.5',critical:true},
    {id:'i2_7',label:'Quarterly fire drills documented for all shifts',code:'NFPA 101 §18.7.1.7 | 19 NYCRR 1225',critical:true},
  ]},
  {id:'occ-i3',title:'🔒 Institutional I-3 – Detention & Correctional',applicableOcc:['I-3'],items:[
    {id:'i3_1',label:'Remote manual release for locked doors complies with IBC §408 and NFPA 101 §22',code:'IBC §408.4 | NFPA 101 §22.2.11',critical:true},
    {id:'i3_2',label:'Mechanical keys or electronic access available to staff at all times',code:'NFPA 101 §22.2.11.8',critical:true},
    {id:'i3_3',label:'Fire drills conducted quarterly; all shifts covered; logs on file',code:'NFPA 101 §22.7.2 | 19 NYCRR 1225',critical:true},
  ]},
  {id:'occ-i4',title:'👶 Institutional I-4 – Adult & Child Day Care',applicableOcc:['I-4'],items:[
    {id:'i4_1',label:'Monthly fire drills conducted and recorded in log',code:'19 NYCRR 1225 | NFPA 101 §16.7',critical:true},
    {id:'i4_2',label:'All sleeping rooms at grade level or sprinkler waiver documented',code:'NFPA 101 §16.2.4',critical:true},
    {id:'i4_3',label:'Single-station smoke alarms in all rooms used for sleeping',code:'NFPA 72 | NYS Exec. Law §378',critical:true},
    {id:'i4_4',label:'State/county operating license posted; fire inspection current',code:'NYS OCFS | 19 NYCRR 1225',critical:false},
  ]},
  {id:'occ-m',title:'🛒 Mercantile (Group M)',applicableOcc:['M'],items:[
    {id:'m1',label:'Sales floor aisles maintained at minimum 28" clear width',code:'IBC §1005 | NFPA 101 §36.2.5',critical:true},
    {id:'m2',label:'High-piled storage (>12 ft) complies with IFC Chapter 32',code:'IFC §3204 | NFPA 13 §12.3',critical:true},
    {id:'m3',label:'Sprinkler system if >12,000 sq ft or 3+ stories; confirm installed',code:'IBC §903.2.7 | 19 NYCRR 1225',critical:true},
    {id:'m4',label:'Storage rooms separated from sales floor with fire-rated assembly',code:'IBC §508 | IFC §315',critical:false},
    {id:'m5',label:'Checkout exits: no merchandise blocking paths to exit doors',code:'IBC §1005 | NFPA 101 §36.2.5',critical:true},
    {id:'m6',label:'Seasonal decorations: flame-retardant or non-combustible',code:'IFC §806 | NFPA 101 §36.3.3',critical:false},
  ]},
  {id:'occ-r1',title:'🏨 Residential R-1 – Hotels & Motels',applicableOcc:['R-1'],items:[
    {id:'r1_1',label:'Sprinkler system throughout if >3 stories or >16 guest units',code:'IBC §903.2.8 | NFPA 13 | 19 NYCRR 1225',critical:true},
    {id:'r1_2',label:'Smoke detectors in every guest room and all corridors',code:'IBC §907.2.9 | NFPA 72',critical:true},
    {id:'r1_3',label:'Carbon monoxide detectors in all guest units',code:'NYS Exec. Law §378 | NFPA 720',critical:true},
    {id:'r1_4',label:'Fire safety information card posted in each guest room',code:'NFPA 101 §28.7.4',critical:false},
    {id:'r1_5',label:'Interior corridors rated and maintained as protected corridors',code:'NFPA 101 §28.3.3 | IBC §1020',critical:true},
  ]},
  {id:'occ-r2',title:'🏠 Residential R-2 – Apartments & Multi-Family',applicableOcc:['R-2'],items:[
    {id:'r2_1',label:'Smoke detectors in every dwelling unit: living area, each bedroom, hallway',code:'NYS Exec. Law §378 | NFPA 72 | IBC §907.2.9',critical:true},
    {id:'r2_2',label:'Carbon monoxide detectors in all dwelling units',code:'NYS Exec. Law §378 | NFPA 720',critical:true},
    {id:'r2_3',label:'Sprinkler system per building height/area triggers; confirm status',code:'IBC §903.2.8 | 19 NYCRR 1225',critical:true},
    {id:'r2_4',label:'Common corridors: emergency lighting and illuminated exit signs operational',code:'IBC §1008 | IBC §1013',critical:true},
    {id:'r2_5',label:'Laundry rooms: dryer vents clean; no combustible storage near dryers',code:'NFPA 211 | IFC §904.12',critical:false},
    {id:'r2_6',label:'Boiler/mechanical rooms: fire-rated door, self-closing, no storage inside',code:'IBC §509 | NFPA 31',critical:false},
    {id:'r2_7',label:'Trash chute rooms: self-closing rated doors; suppression at chute head',code:'IBC §708.13 | NFPA 82',critical:false},
    {id:'r2_8',label:'No e-bikes/scooters charging in common corridors or stairwells',code:'IFC §1207.10 | 19 NYCRR 1225',critical:true},
  ]},
  {id:'occ-r3',title:'🏡 Residential R-3 – 1 & 2 Family Dwellings',applicableOcc:['R-3'],items:[
    {id:'r3_1',label:'Smoke alarms on every habitable floor level and inside each bedroom',code:'NYS Exec. Law §378 | IRC §R314',critical:true},
    {id:'r3_2',label:'Carbon monoxide alarms on each floor level with sleeping areas',code:'NYS Exec. Law §378 | IRC §R315',critical:true},
    {id:'r3_3',label:'Smoke alarms interconnected throughout dwelling',code:'IRC §R314.4 | 19 NYCRR 1225',critical:true},
    {id:'r3_4',label:'Garage (if attached): 5/8" type-X drywall separation; self-closing fire door',code:'IRC §R302.5 | IBC §406',critical:false},
  ]},
  {id:'occ-r4',title:'🏠 Residential R-4 – Residential Care (≤16)',applicableOcc:['R-4'],items:[
    {id:'r4_1',label:'Full sprinkler system throughout per NFPA 13D or 13R',code:'IBC §903.2.8 | NFPA 13D',critical:true},
    {id:'r4_2',label:'Smoke detectors in all bedrooms and common corridors',code:'NFPA 72 | 19 NYCRR 1225',critical:true},
    {id:'r4_3',label:'Fire drills at least twice per year; logs on file',code:'NFPA 101 §32.7.2 | 19 NYCRR 1225',critical:true},
  ]},
  {id:'occ-s1',title:'📦 Storage S-1 – Moderate-Hazard',applicableOcc:['S-1'],items:[
    {id:'s1_1',label:'Commodity classification documented; storage height within limits',code:'IFC §3203 | NFPA 13 §12.1',critical:true},
    {id:'s1_2',label:'Flue spaces maintained in rack storage (6" transverse, 3" longitudinal)',code:'IFC §3206 | NFPA 13 §17.4',critical:true},
    {id:'s1_3',label:'In-rack sprinklers installed where required by height/commodity class',code:'NFPA 13 §17 | IFC §3204',critical:true},
    {id:'s1_4',label:'Loading dock doors kept closed when not in active use',code:'IFC §315 | IBC §706',critical:false},
    {id:'s1_5',label:'Forklift charging stations: adequate ventilation per NFPA 70 §625',code:'NFPA 70 §625 | OSHA 29 CFR 1910.178',critical:false},
  ]},
  {id:'occ-s2',title:'📦 Storage S-2 – Low-Hazard',applicableOcc:['S-2'],items:[
    {id:'s2_1',label:'Storage confirmed as non-combustible or limited-combustible',code:'IBC §311.3 | IFC §315',critical:false},
    {id:'s2_2',label:'All aisles maintained clear for fire department access (min. 8 ft)',code:'IFC §315 | NFPA 1',critical:true},
  ]},
  {id:'occ-u',title:'🔧 Utility / Miscellaneous (Group U)',applicableOcc:['U'],items:[
    {id:'u1',label:'Agricultural/utility buildings free of flammable storage near heat sources',code:'IBC §312 | IFC §315',critical:false},
    {id:'u2',label:'Carports and detached structures meet fire separation distances',code:'IBC §312.1 | Yorktown Ch.130',critical:false},
  ]},
];

function sectionsForOcc(occ) {
  return ALL_SECTIONS.filter(sec => !sec.applicableOcc || sec.applicableOcc.includes(occ));
}

// ═══════════════════════════════════════════════════════════════
// INSPECTION ENGINE
// ═══════════════════════════════════════════════════════════════
async function startInsp(bizId) {
  const biz = S.businesses.find(b => b.id === bizId);
  if (!biz) return;
  S.curBiz = biz;
  const draft = S.inspections.find(i => i.bizId === bizId && i.status === 'draft');
  if (draft && confirm(`Resume existing draft inspection for ${biz.name}?`)) {
    S.curInsp = { ...draft };
    S.curInsp.sections = sectionsForOcc(biz.occupancy);
  } else {
    const id = 'insp_' + Date.now();
    S.curInsp = {
      id, bizId: biz.id, bizName: biz.name,
      bizAddress: `${biz.address}, ${biz.city}, NY ${biz.zip}`,
      occupancy: biz.occupancy, date: new Date().toISOString(),
      status: 'draft',
      secAnswers: {}, itemAnswers: {}, itemNotes: {}, itemPhotos: {}, secNotes: {},
      sections: sectionsForOcc(biz.occupancy)
    };
    await saveInspection();
  }
  renderInsp();
  showScreen('inspection');
}

async function saveInspection() {
  if (!S.curInsp) return;
  const { sections, ...toSave } = S.curInsp; // don't store static section data
  await saveDoc('inspections', S.curInsp.id, toSave);
}

function renderInsp() {
  const insp = S.curInsp, biz = S.curBiz;
  if (!insp || !biz) return;
  document.getElementById('insp-ph').classList.add('hidden');
  document.getElementById('insp-body').classList.remove('hidden');
  document.getElementById('ib-name').textContent = biz.name;
  document.getElementById('ib-addr').textContent = `${biz.address}, ${biz.city}, NY ${biz.zip}`;
  document.getElementById('ib-badges').innerHTML =
    `<span class="badge bdb">${OL[biz.occupancy] || biz.occupancy}</span>
     <span class="badge bdgr">${new Date().toLocaleDateString()}</span>
     ${biz.sprinkler && biz.sprinkler !== 'unknown' && biz.sprinkler !== 'no' ? '<span class="badge bdg">💧 Sprinklered</span>' : ''}
     ${biz.liion && biz.liion !== 'none' ? '<span class="badge bdp">🔋 Li-Ion</span>' : ''}`;
  const alertDiv = document.getElementById('ib-alerts');
  alertDiv.innerHTML = '';
  if (['H-1','H-2','H-3','H-4','H-5'].includes(biz.occupancy))
    alertDiv.innerHTML += `<div class="al al-red">⚠️ <div><strong>High-Hazard Occupancy:</strong> All critical items require Pass or documented abatement plan before leaving.</div></div>`;
  if (['I-1','I-2'].includes(biz.occupancy))
    alertDiv.innerHTML += `<div class="al al-orange">🏥 <div><strong>Institutional:</strong> Confirm emergency generator, compartmentation, and defend-in-place status.</div></div>`;
  if (biz.liion && biz.liion !== 'none')
    alertDiv.innerHTML += `<div class="al al-purple">🔋 <div><strong>Li-Ion / ESS Present:</strong> Complete Lithium-Ion Battery section. Thermal runaway is a serious risk.</div></div>`;
  if (biz.notes)
    alertDiv.innerHTML += `<div class="al al-blue">📝 <div><strong>Note:</strong> ${biz.notes}</div></div>`;
  updateProgress();
  buildChecklistUI();
}

function buildChecklistUI() {
  const insp = S.curInsp;
  const cl = document.getElementById('ib-checklist');
  cl.innerHTML = '';
  insp.sections.forEach(sec => {
    const secAns = insp.secAnswers[sec.id] || '';
    const isNA = secAns === 'na';
    let p = 0, f = 0, n = 0;
    sec.items.forEach(it => {
      const a = insp.itemAnswers[it.id];
      if (a === 'pass') p++; else if (a === 'fail') f++; else if (a === 'na') n++;
    });
    const done = p + f + n;
    let hdrClass = secAns === 'pass' ? ' sec-pass' : secAns === 'fail' ? ' sec-fail' : isNA ? ' sec-na' : '';
    const el = document.createElement('div');
    el.className = 'card sec-wrap';
    el.innerHTML = `
      <div class="sec-hdr${hdrClass}" id="shdr-${sec.id}">
        <span style="flex:1;text-align:left;font-size:12px">${sec.title}</span>
        <span class="sec-progress">${done}/${sec.items.length}</span>
        <div class="sec-pfa" onclick="event.stopPropagation()">
          <button class="spf-btn sp-pass${secAns==='pass'?' sel':''}" onclick="setSec('${sec.id}','pass')">✓</button>
          <button class="spf-btn sp-fail${secAns==='fail'?' sel':''}" onclick="setSec('${sec.id}','fail')">✗</button>
          <button class="spf-btn sp-na${secAns==='na'?' sel':''}" onclick="setSec('${sec.id}','na')">N/A</button>
        </div>
        <button class="sec-toggle-btn" onclick="toggleSec('${sec.id}')" id="stog-${sec.id}">▶</button>
      </div>
      <div class="sec-items" id="sitems-${sec.id}">
        ${sec.items.map(it => itemHTML(it, insp, isNA)).join('')}
        ${secAns==='fail' ? `<div style="padding:10px 13px;background:var(--red-light)">
          <textarea style="width:100%;padding:8px;border:1.5px solid var(--border);border-radius:8px;font-size:12px;font-family:var(--font);resize:vertical;background:var(--white);color:var(--text)"
            placeholder="Section violation notes…" id="secnote-${sec.id}"
            onchange="saveSecNote('${sec.id}',this.value)">${insp.secNotes && insp.secNotes[sec.id] || ''}</textarea>
        </div>` : ''}
      </div>`;
    el.querySelector(`#shdr-${sec.id}`).addEventListener('click', function(e) {
      if (e.target.closest('.sec-pfa') || e.target.closest('.sec-toggle-btn')) return;
      toggleSec(sec.id);
    });
    cl.appendChild(el);
  });
}

function itemHTML(item, insp, sectionIsNA) {
  const ans = insp.itemAnswers[item.id] || '';
  const note = insp.itemNotes[item.id] || '';
  const photos = (insp.itemPhotos && insp.itemPhotos[item.id]) || [];
  const disabled = sectionIsNA ? 'ci-na' : '';
  const failBg = ans === 'fail' && !sectionIsNA ? ' ci-fail' : '';
  const photoHtml = photos.length > 0
    ? `<div class="ci-photos">${photos.map((p, i) => `<img class="ci-photo-thumb" src="${p.data || p}" alt="photo" onclick="viewPhoto('${item.id}',${i})">`).join('')}
       <div style="width:68px;height:68px;border-radius:8px;border:2px dashed var(--border);background:var(--gray-light);display:flex;align-items:center;justify-content:center;font-size:24px;cursor:pointer;color:var(--text-muted)" onclick="capturePhoto('${item.id}')">📷</div></div>`
    : '';
  return `
    <div class="ci ${disabled}${failBg}" id="ci-${item.id}">
      <div class="ci-ctrl">
        <div class="rg">
          <button class="rb rp${ans==='pass'?' sel':''}" onclick="setItem('${item.id}','pass')">P</button>
          <button class="rb rf${ans==='fail'?' sel':''}" onclick="setItem('${item.id}','fail')">F</button>
          <button class="rb rn${ans==='na'?' sel':''}" onclick="setItem('${item.id}','na')">—</button>
        </div>
      </div>
      <div class="ci-body">
        <div class="ci-lbl">${item.critical ? '<span class="crit-star">★</span>' : ''}${item.label}</div>
        <div class="ci-code">📜 ${item.code}</div>
        <textarea class="ci-note${note || ans === 'fail' ? ' show' : ''}" id="note-${item.id}"
          placeholder="Inspector notes / violation details…"
          onchange="saveItemNote('${item.id}',this.value)">${note}</textarea>
        <div class="ci-note-actions">
          <button class="note-toggle" onclick="toggleNote('${item.id}')">✏️ ${note ? 'Edit note' : 'Add note'}</button>
          <span style="color:var(--border-dark);margin:0 4px">·</span>
          <button class="photo-toggle" onclick="capturePhoto('${item.id}')">📷 ${photos.length > 0 ? photos.length + ' photo(s)' : 'Add photo'}</button>
        </div>
        ${photoHtml}
      </div>
    </div>`;
}

let _saveTimer2;
function debouncedSave() {
  clearTimeout(_saveTimer2);
  _saveTimer2 = setTimeout(() => saveInspection(), 1200);
}

function setSec(secId, val) {
  const insp = S.curInsp; if (!insp) return;
  insp.secAnswers[secId] = val;
  const sec = insp.sections.find(s => s.id === secId);
  if (sec) {
    if (val === 'pass') sec.items.forEach(it => { if (!insp.itemAnswers[it.id]) insp.itemAnswers[it.id] = 'pass'; });
    if (val === 'na') sec.items.forEach(it => { insp.itemAnswers[it.id] = 'na'; });
  }
  debouncedSave();
  buildChecklistUI();
  updateProgress();
}

function saveSecNote(secId, val) {
  if (!S.curInsp) return;
  S.curInsp.secNotes[secId] = val;
  debouncedSave();
}

function setItem(itemId, val) {
  const insp = S.curInsp; if (!insp) return;
  insp.itemAnswers[itemId] = val;
  const ci = document.getElementById('ci-' + itemId);
  if (ci) {
    ci.querySelectorAll('.rb').forEach(b => b.classList.remove('sel'));
    const cls = val === 'pass' ? '.rp' : val === 'fail' ? '.rf' : '.rn';
    const btn = ci.querySelector(cls); if (btn) btn.classList.add('sel');
    ci.classList.toggle('ci-fail', val === 'fail');
    if (val === 'fail') { const n = document.getElementById('note-' + itemId); if (n) n.classList.add('show'); }
  }
  const sec = insp.sections.find(s => s.items.some(i => i.id === itemId));
  if (sec) {
    const allAns = sec.items.every(i => !!insp.itemAnswers[i.id]);
    if (allAns) {
      const anyFail = sec.items.some(i => insp.itemAnswers[i.id] === 'fail');
      const allNA = sec.items.every(i => insp.itemAnswers[i.id] === 'na');
      const newSec = allNA ? 'na' : anyFail ? 'fail' : 'pass';
      insp.secAnswers[sec.id] = newSec;
      const hdr = document.getElementById('shdr-' + sec.id);
      if (hdr) {
        hdr.querySelectorAll('.spf-btn').forEach(b => b.classList.remove('sel'));
        const sb = hdr.querySelector(newSec === 'pass' ? '.sp-pass' : newSec === 'fail' ? '.sp-fail' : '.sp-na');
        if (sb) sb.classList.add('sel');
        hdr.className = 'sec-hdr' + (newSec === 'pass' ? ' sec-pass' : newSec === 'fail' ? ' sec-fail' : newSec === 'na' ? ' sec-na' : '');
      }
    }
  }
  debouncedSave();
  updateProgress();
}

function toggleNote(itemId) {
  const n = document.getElementById('note-' + itemId);
  if (n) n.classList.toggle('show');
}
function saveItemNote(itemId, val) {
  if (!S.curInsp) return;
  S.curInsp.itemNotes[itemId] = val;
  debouncedSave();
}
function toggleSec(secId) {
  const el = document.getElementById('sitems-' + secId);
  const tog = document.getElementById('stog-' + secId);
  if (!el) return;
  el.classList.toggle('open');
  if (tog) tog.textContent = el.classList.contains('open') ? '▼' : '▶';
}

function updateProgress() {
  const insp = S.curInsp; if (!insp) return;
  let total = 0, pass = 0, fail = 0, na = 0;
  insp.sections.forEach(s => s.items.forEach(i => {
    total++;
    const a = insp.itemAnswers[i.id];
    if (a === 'pass') pass++; else if (a === 'fail') fail++; else if (a === 'na') na++;
  }));
  const done = pass + fail + na;
  const pct = total > 0 ? Math.round(done / total * 100) : 0;
  const bar = document.getElementById('ib-prog');
  const pctEl = document.getElementById('ib-pct');
  if (bar) { bar.style.width = pct + '%'; bar.className = 'pb' + (fail > 0 ? ' pb-danger' : pct < 50 ? ' pb-warn' : ''); }
  if (pctEl) pctEl.textContent = pct + '%';
  ['pass','fail','na'].forEach((k, i) => { const el = document.getElementById('qi-'+k); if (el) el.textContent = [pass,fail,na][i]; });
  const ql = document.getElementById('qi-left'); if (ql) ql.textContent = (total - done) || '—';
}

// ─── Photo Capture ────────────────────────────────────────
function capturePhoto(itemId) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*'; input.capture = 'environment';
  input.onchange = function(e) {
    const file = e.target.files[0]; if (!file) return;
    // Compress image before storing
    const reader = new FileReader();
    reader.onload = function(ev) {
      const img = new Image();
      img.onload = function() {
        const canvas = document.createElement('canvas');
        const MAX = 800;
        let w = img.width, h = img.height;
        if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
        if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const data = canvas.toDataURL('image/jpeg', 0.75);
        if (!S.curInsp.itemPhotos) S.curInsp.itemPhotos = {};
        if (!S.curInsp.itemPhotos[itemId]) S.curInsp.itemPhotos[itemId] = [];
        S.curInsp.itemPhotos[itemId].push({ data, timestamp: new Date().toISOString() });
        debouncedSave();
        buildChecklistUI();
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

function viewPhoto(itemId, idx) {
  const photos = (S.curInsp && S.curInsp.itemPhotos && S.curInsp.itemPhotos[itemId]) || [];
  if (!photos[idx]) return;
  document.getElementById('photo-modal-img').src = photos[idx].data || photos[idx];
  document.getElementById('photo-modal-cap').textContent = 'Taken: ' + new Date(photos[idx].timestamp || '').toLocaleString();
  document.getElementById('photo-del-btn').onclick = () => {
    S.curInsp.itemPhotos[itemId].splice(idx, 1);
    debouncedSave(); buildChecklistUI(); closeMo('mo-photo');
  };
  openMo('mo-photo');
}

// ─── Complete Inspection ──────────────────────────────────
// Tracks selected deadline days for the current completion flow
let _completionDeadlineDays = 30;

function setDeadline(days, el) {
  _completionDeadlineDays = days;
  document.querySelectorAll('.dl-btn').forEach(b => b.classList.remove('sel'));
  el.classList.add('sel');
}

function completeInsp() {
  const insp = S.curInsp; if (!insp) return;
  const viols = collectViolations(insp);
  let p = 0, f = 0, na = 0;
  insp.sections.forEach(s => s.items.forEach(i => {
    const a = insp.itemAnswers[i.id];
    if (a === 'pass') p++; else if (a === 'fail') f++; else if (a === 'na') na++;
  }));
  const total = insp.sections.reduce((t, s) => t + s.items.length, 0);
  const unanswered = total - p - f - na;
  document.getElementById('mo-comp-sum').innerHTML = `
    <div class="sg">
      <div class="sc"><div class="sn" style="color:var(--green)">${p}</div><div class="sl">Passed</div></div>
      <div class="sc"><div class="sn" style="color:var(--red)">${viols.length}</div><div class="sl">Violations</div></div>
      <div class="sc"><div class="sn" style="color:var(--gray)">${na}</div><div class="sl">N/A</div></div>
      <div class="sc"><div class="sn" style="color:${unanswered>0?'var(--orange)':'var(--green)'}">${unanswered}</div><div class="sl">Left</div></div>
    </div>
    ${unanswered > 0 ? `<div class="al al-orange">⚠️ <div><strong>${unanswered} item(s) unanswered.</strong> You may finalize anyway or return to complete.</div></div>` : ''}
    ${viols.length > 0
      ? `<div class="al al-red">🔴 <div><strong>${viols.length} violation(s) found</strong> · ${viols.filter(v=>v.critical).length} critical. Email report required.</div></div>
         ${viols.slice(0,5).map(v=>`<div style="padding:7px 10px;border-left:3px solid ${v.critical?'var(--red)':'var(--orange)'};margin-bottom:4px;background:var(--gray-light);border-radius:0 7px 7px 0">
           <div style="font-size:12px;font-weight:700">${v.critical?'★ ':''}${v.label}</div>
           <div style="font-size:10px;color:var(--blue);font-family:var(--mono)">${v.code}</div>
         </div>`).join('')}
         ${viols.length > 5 ? `<div style="font-size:11px;color:var(--text-muted);padding:4px">+${viols.length-5} more…</div>` : ''}`
      : `<div class="al al-green">✅ <div><strong>No violations detected.</strong> Excellent compliance!</div></div>`}`;
  document.getElementById('comp-sig').value = S.settings.inspectorName || '';
  _completionDeadlineDays = S.settings.defaultDeadlineDays || 30;
  openMo('mo-complete');
}

function collectViolations(insp) {
  const viols = [];
  insp.sections.forEach(sec => {
    sec.items.forEach(it => {
      if (insp.itemAnswers[it.id] === 'fail') {
        viols.push({ ...it, sectionTitle: sec.title, note: insp.itemNotes[it.id] || '', photos: (insp.itemPhotos && insp.itemPhotos[it.id]) || [] });
      }
    });
  });
  return viols;
}

async function finalizeInsp() {
  const insp = S.curInsp; if (!insp) return;
  const sig = document.getElementById('comp-sig').value.trim();
  if (!sig) { alert('Please enter your signature to finalize.'); return; }
  insp.status = 'completed';
  insp.completedDate = new Date().toISOString();
  insp.signature = sig;
  insp.completionNotes = document.getElementById('comp-notes').value;
  insp.deadlineDays = _completionDeadlineDays;

  const viols = collectViolations(insp);
  const batch = FB().writeBatch(db());

  // Save inspection
  const { sections, ...inspData } = insp;
  batch.set(userDoc('inspections', insp.id), { ...inspData, _updatedAt: FB().serverTimestamp() });

  // Save violations
  viols.forEach(v => {
    const exists = S.violations.find(x => x.itemId === v.id && x.bizId === insp.bizId && x.status === 'open');
    if (!exists) {
      const deadline = new Date();
      deadline.setDate(deadline.getDate() + _completionDeadlineDays);
      const id = 'viol_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      batch.set(userDoc('violations', id), {
        bizId: insp.bizId, bizName: insp.bizName, bizAddress: insp.bizAddress,
        itemId: v.id, label: v.label, code: v.code, critical: v.critical,
        note: v.note, sectionTitle: v.sectionTitle,
        inspectionId: insp.id, date: insp.completedDate,
        deadlineDate: deadline.toISOString(), deadlineDays: _completionDeadlineDays,
        status: 'open', _updatedAt: FB().serverTimestamp()
      });
    }
  });

  showSync('saving');
  try {
    await batch.commit();
    showSync('saved');
  } catch (e) { showSync('error'); console.error(e); return; }

  closeMo('mo-complete');
  S.curInsp = null; S.curBiz = null;
  document.getElementById('insp-ph').classList.remove('hidden');
  document.getElementById('insp-body').classList.add('hidden');
  showScreen('dashboard');
  alert(`✅ Inspection finalized and saved to cloud!\n\n${viols.length} violation(s) logged.`);
}

async function saveDraft() {
  if (!S.curInsp) return;
  S.curInsp.status = 'draft';
  await saveInspection();
  alert('✅ Draft saved to cloud!');
}

function sendEmailFromModal() {
  buildAndShowEmail(S.curInsp, S.curBiz);
  closeMo('mo-complete');
  openMo('mo-email');
}

// ─── Email Builder ────────────────────────────────────────
function buildEmailBody(insp, biz, allViols) {
  const s = S.settings;
  const inspName = s.inspectorName || '[Inspector Name]';
  const dt = new Date(insp.completedDate || insp.date).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
  const viols = allViols || collectViolations(insp);
  const critV = viols.filter(v => v.critical);
  const stdV = viols.filter(v => !v.critical);
  const deadline = new Date();
  deadline.setDate(deadline.getDate() + (insp.deadlineDays || _completionDeadlineDays || 30));
  const dlStr = deadline.toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });

  let body = `TOWN OF YORKTOWN\nBUREAU OF FIRE PREVENTION\n`;
  body += `════════════════════════════════════════════════════\n`;
  body += `FIRE INSPECTION VIOLATION NOTICE\n════════════════════════════════════════════════════\n\n`;
  body += `Inspection Date:   ${dt}\nProperty:          ${biz.name}\n`;
  body += `Address:           ${biz.address}, ${biz.city}, NY ${biz.zip}\n`;
  body += `IBC Occupancy:     ${OL[biz.occupancy] || biz.occupancy}\n`;
  if (biz.constType) body += `Construction Type: ${biz.constType}\n`;
  body += `Responsible Party: ${biz.contact}\n`;
  if (biz.contactPhone) body += `Contact Phone:     ${biz.contactPhone}\n`;
  body += `\nInspecting Officer: ${inspName}`;
  if (s.inspectorBadge) body += ` (Badge: ${s.inspectorBadge})`;
  if (s.inspectorCert) body += ` — ${s.inspectorCert}`;
  body += `\n`;
  if (s.inspectorPhone) body += `Phone: ${s.inspectorPhone}  `;
  if (s.inspectorEmail) body += `Email: ${s.inspectorEmail}`;
  body += `\nIssuing Authority: ${s.deptName || 'Town of Yorktown Building Department'}\n`;
  if (s.deptAddr) body += `                   ${s.deptAddr}\n`;
  body += `\n════════════════════════════════════════════════════\n`;
  body += `INSPECTION SUMMARY\n════════════════════════════════════════════════════\n\n`;
  body += `Total Violations:    ${viols.length}\nCritical:            ${critV.length}\nStandard:            ${stdV.length}\nCorrection Deadline: ${dlStr}\n\n`;
  if (critV.length > 0) {
    body += `────────────────────────────────────────────────────\n★  CRITICAL VIOLATIONS – IMMEDIATE ACTION REQUIRED\n────────────────────────────────────────────────────\n`;
    critV.forEach((v, i) => {
      body += `\n${i+1}. ${v.label}\n   Code: ${v.code}\n   Section: ${v.sectionTitle}\n`;
      if (v.note) body += `   Notes: ${v.note}\n`;
    });
    body += '\n';
  }
  if (stdV.length > 0) {
    body += `────────────────────────────────────────────────────\nSTANDARD VIOLATIONS\n────────────────────────────────────────────────────\n`;
    stdV.forEach((v, i) => {
      body += `\n${i+1}. ${v.label}\n   Code: ${v.code}\n   Section: ${v.sectionTitle}\n`;
      if (v.note) body += `   Notes: ${v.note}\n`;
    });
    body += '\n';
  }
  if (insp.completionNotes) body += `GENERAL NOTES\n────────────────────────────────────────────────────\n${insp.completionNotes}\n\n`;
  body += `════════════════════════════════════════════════════\nREQUIRED CORRECTIVE ACTIONS\n════════════════════════════════════════════════════\n\n`;
  body += `• Critical violations must be corrected IMMEDIATELY or within 24-72 hours\n`;
  body += `• All violations must be corrected by: ${dlStr}\n`;
  body += `• Submit written corrective action plan to:\n  ${s.deptName || 'Town of Yorktown Building Department'}\n`;
  if (s.deptAddr) body += `  ${s.deptAddr}\n`;
  if (s.deptPhone) body += `  Phone: ${s.deptPhone}\n`;
  if (s.deptEmail) body += `  Email: ${s.deptEmail}\n`;
  body += `• Re-inspection required upon completion\n`;
  body += `• Failure to correct may result in fines, appearance tickets, or Order to Vacate\n\n`;
  body += `APPLICABLE CODES: NYS 19 NYCRR Part 1225 · Yorktown Ch.130 · 2020 IBC · 2021 IFC · NFPA standards as cited\n\n`;
  if (insp.signature) body += `════════════════════════════════════════════════════\n${insp.signature}\n${s.inspectorBadge ? 'Badge: ' + s.inspectorBadge + '\n' : ''}${s.deptName || 'Town of Yorktown Bureau of Fire Prevention'}\n${dt}\n`;
  return body;
}

function buildAndShowEmail(insp, biz) {
  if (!insp || !biz) return;
  const s = S.settings;
  const viols = collectViolations(insp);
  const dt = new Date(insp.completedDate || insp.date).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
  const to = [biz.contactEmail, s.inspectorEmail, s.deptEmail].filter(Boolean).join(',');
  const subj = viols.length > 0
    ? `VIOLATION NOTICE – Fire Inspection: ${biz.name} – ${dt}`
    : `Fire Inspection Compliance – ${biz.name} – ${dt}`;
  const body = viols.length > 0 ? buildEmailBody(insp, biz, viols)
    : `TOWN OF YORKTOWN – BUREAU OF FIRE PREVENTION\n\nFire Inspection Compliance Confirmation\n\nDate: ${dt}\nProperty: ${biz.name}\nAddress: ${biz.address}, ${biz.city}, NY ${biz.zip}\nOccupancy: ${OL[biz.occupancy]||biz.occupancy}\nInspector: ${s.inspectorName||'[Inspector]'}\n\nRESULT: ✅ NO VIOLATIONS FOUND\n\n${s.inspectorName||'[Inspector]'}\n${s.deptName||'Town of Yorktown Bureau of Fire Prevention'}`;
  window._emailData = { to, subj, body };
  document.getElementById('email-preview').innerHTML = `
    <div class="al al-blue" style="font-size:12px"><strong>To:</strong> ${to || '(configure emails in Settings)'}</div>
    <div class="al al-orange" style="font-size:12px"><strong>Subject:</strong> ${subj}</div>
    <div style="background:var(--gray-light);padding:12px;border-radius:8px;font-size:11px;white-space:pre-wrap;font-family:var(--mono);max-height:280px;overflow-y:auto;border:1px solid var(--border)">${body.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>`;
  document.getElementById('btn-open-email').onclick = () =>
    window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}`;
}

function copyEmail() {
  const d = window._emailData;
  if (!d) return;
  const txt = `To: ${d.to}\nSubject: ${d.subj}\n\n${d.body}`;
  navigator.clipboard.writeText(txt).then(() => alert('✅ Copied!')).catch(() => {
    const ta = document.createElement('textarea'); ta.value = txt;
    document.body.appendChild(ta); ta.select(); document.execCommand('copy');
    document.body.removeChild(ta); alert('✅ Copied!');
  });
}

function openStandaloneEmail() {
  const sel = document.getElementById('email-biz-select');
  sel.innerHTML = '<option value="">— All Open Violations —</option>';
  const ids = [...new Set(S.violations.filter(v => v.status === 'open').map(v => v.bizId))];
  ids.forEach(id => {
    const b = S.businesses.find(x => x.id === id);
    if (b) sel.innerHTML += `<option value="${id}">${b.name}</option>`;
  });
  previewStandaloneEmail();
  openMo('mo-email-standalone');
}

function previewStandaloneEmail() {
  const bizId = document.getElementById('email-biz-select').value;
  const viols = bizId
    ? S.violations.filter(v => v.bizId === bizId && v.status === 'open')
    : S.violations.filter(v => v.status === 'open');
  if (!viols.length) {
    document.getElementById('standalone-email-preview').innerHTML = '<div class="al al-green">✅ No open violations to report.</div>';
    window._standaloneEmailData = null; return;
  }
  const s = S.settings;
  const dt = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
  const to = [s.inspectorEmail, s.deptEmail].filter(Boolean).join(',');
  const bizName = bizId ? (S.businesses.find(b => b.id === bizId) || {}).name : 'All Properties';
  const subj = `Open Violation Report – ${bizName} – ${dt}`;
  let body = `TOWN OF YORKTOWN – BUREAU OF FIRE PREVENTION\nOPEN VIOLATION REPORT\nGenerated: ${dt}\nBy: ${s.inspectorName||'[Inspector]'}\n\n`;
  const grouped = {};
  viols.forEach(v => { grouped[v.bizName] = grouped[v.bizName] || []; grouped[v.bizName].push(v); });
  Object.entries(grouped).forEach(([name, vv]) => {
    body += `\n═══ ${name} ═══\n`;
    vv.forEach((v, i) => {
      body += `${i+1}. ${v.critical?'★ ':''}${v.label}\n   Code: ${v.code}\n`;
      if (v.note) body += `   Notes: ${v.note}\n`;
      if (v.deadlineDate) body += `   Deadline: ${new Date(v.deadlineDate).toLocaleDateString()}\n`;
    });
  });
  window._standaloneEmailData = { to, subj, body };
  document.getElementById('standalone-email-preview').innerHTML = `
    <div class="al al-blue" style="font-size:12px"><strong>To:</strong> ${to || '(configure in Settings)'}</div>
    <div class="al al-orange" style="font-size:12px"><strong>Subject:</strong> ${subj}</div>
    <div style="background:var(--gray-light);padding:11px;border-radius:8px;font-size:11px;white-space:pre-wrap;font-family:var(--mono);max-height:220px;overflow-y:auto">${body.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>`;
  document.getElementById('btn-standalone-open').onclick = () => {
    window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}`;
  };
}

function copyStandaloneEmail() {
  const d = window._standaloneEmailData; if (!d) return;
  const txt = `To: ${d.to}\nSubject: ${d.subj}\n\n${d.body}`;
  navigator.clipboard.writeText(txt).then(() => alert('✅ Copied!')).catch(() => alert('Could not copy'));
}

// ─── Print / PDF ──────────────────────────────────────────
function printReport() {
  const insp = S.curInsp, biz = S.curBiz;
  if (!insp || !biz) { alert('No active inspection.'); return; }
  generatePrintReport(insp, biz);
  window.print();
}

function generatePrintReport(insp, biz) {
  const viols = collectViolations(insp);
  const s = S.settings;
  const dt = new Date(insp.completedDate || insp.date).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
  const dl = insp.deadlineDays ? new Date(new Date().setDate(new Date().getDate() + insp.deadlineDays)).toLocaleDateString() : '—';
  document.getElementById('print-report-content').innerHTML = `
    <div style="font-family:sans-serif;max-width:700px;margin:0 auto">
      <div style="border-bottom:3px solid #c0392b;padding-bottom:12px;margin-bottom:16px">
        <div style="font-size:20pt;font-weight:900;color:#922b21">🔥 TOWN OF YORKTOWN</div>
        <div style="font-size:12pt;font-weight:700;color:#555;letter-spacing:1px">BUREAU OF FIRE PREVENTION — INSPECTION REPORT</div>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:10pt;margin-bottom:14px">
        <tr><td style="padding:3px 6px;font-weight:700;width:40%">Inspection Date</td><td>${dt}</td></tr>
        <tr style="background:#f8f8f8"><td style="padding:3px 6px;font-weight:700">Property</td><td>${biz.name}</td></tr>
        <tr><td style="padding:3px 6px;font-weight:700">Address</td><td>${biz.address}, ${biz.city}, NY ${biz.zip}</td></tr>
        <tr style="background:#f8f8f8"><td style="padding:3px 6px;font-weight:700">IBC Occupancy</td><td>${OL[biz.occupancy]||biz.occupancy}</td></tr>
        <tr><td style="padding:3px 6px;font-weight:700">Construction Type</td><td>${biz.constType||'—'}</td></tr>
        <tr style="background:#f8f8f8"><td style="padding:3px 6px;font-weight:700">Responsible Party</td><td>${biz.contact}</td></tr>
        <tr><td style="padding:3px 6px;font-weight:700">Inspector</td><td>${insp.signature||s.inspectorName||'—'}${s.inspectorBadge?' (Badge: '+s.inspectorBadge+')':''}</td></tr>
        <tr style="background:#f8f8f8"><td style="padding:3px 6px;font-weight:700">Total Violations</td><td style="color:${viols.length>0?'#c0392b':'#27ae60'};font-weight:800">${viols.length} (${viols.filter(v=>v.critical).length} Critical)</td></tr>
      </table>
      ${viols.length > 0 ? `
        <div style="font-size:11pt;font-weight:900;color:#922b21;border-bottom:2px solid #c0392b;padding-bottom:4px;margin-bottom:10px">VIOLATIONS FOUND</div>
        ${viols.filter(v=>v.critical).length > 0 ? `<div style="font-weight:800;color:#922b21;margin-bottom:6px;font-size:10pt">★ CRITICAL</div>
          ${viols.filter(v=>v.critical).map((v,i)=>`<div style="border-left:4px solid #c0392b;padding:6px 10px;margin-bottom:6px;background:#fef0f0">
            <div style="font-weight:700">${i+1}. ${v.label}</div>
            <div style="color:#2471a3;font-size:9pt;font-family:monospace">Code: ${v.code}</div>
            ${v.note?`<div style="color:#666;font-size:9pt">Notes: ${v.note}</div>`:''}
          </div>`).join('')}` : ''}
        ${viols.filter(v=>!v.critical).length > 0 ? `<div style="font-weight:800;color:#e67e22;margin:10px 0 6px;font-size:10pt">STANDARD</div>
          ${viols.filter(v=>!v.critical).map((v,i)=>`<div style="border-left:4px solid #e67e22;padding:6px 10px;margin-bottom:6px;background:#fef6ec">
            <div style="font-weight:700">${i+1}. ${v.label}</div>
            <div style="color:#2471a3;font-size:9pt;font-family:monospace">Code: ${v.code}</div>
            ${v.note?`<div style="color:#666;font-size:9pt">Notes: ${v.note}</div>`:''}
          </div>`).join('')}` : ''}
        <div style="margin-top:14px;padding:10px;background:#fff3cd;border:1px solid #ffc107;border-radius:4px;font-size:10pt">
          <strong>Correction Deadline: ${dl}</strong><br>
          Submit corrective action plan to: ${s.deptName||'Town of Yorktown Building Department'} · ${s.deptPhone||''} · ${s.deptEmail||''}<br>
          Re-inspection required upon completion.
        </div>` : `<div style="padding:12px;background:#d5f5e3;border-left:4px solid #27ae60;font-weight:700;color:#1a6b3a">✅ NO VIOLATIONS FOUND — PROPERTY IN COMPLIANCE</div>`}
      ${insp.completionNotes ? `<div style="margin-top:12px"><strong>Notes:</strong> ${insp.completionNotes}</div>` : ''}
      <div style="margin-top:24px;border-top:1px solid #ccc;padding-top:12px;font-size:9pt;color:#888">
        Code Basis: NYS 19 NYCRR Part 1225 · Yorktown Ch.130 · 2020 IBC/2021 IFC · NFPA standards as cited<br>
        ${s.deptName||'Town of Yorktown Bureau of Fire Prevention'} · ${s.deptAddr||'363 Underhill Ave, Yorktown Heights, NY 10598'}
      </div>
    </div>`;
  document.getElementById('screen-print-report').style.display = 'block';
}

// ─── Inspection History ───────────────────────────────────
function viewHistory(bizId) {
  const biz = S.businesses.find(b => b.id === bizId);
  const inspList = S.inspections.filter(i => i.bizId === bizId && i.status === 'completed')
    .sort((a, b) => new Date(b.completedDate) - new Date(a.completedDate));
  document.getElementById('hist-mo-title').textContent = `📋 ${biz?.name || ''}`;
  document.getElementById('hist-mo-body').innerHTML = !inspList.length
    ? '<div class="es"><p>No completed inspections yet.</p></div>'
    : inspList.map(insp => {
        const vc = S.violations.filter(v => v.inspectionId === insp.id).length;
        const dt = new Date(insp.completedDate).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
        return `<div class="hist-item" onclick="viewPastReport('${insp.id}')">
          <div style="font-size:11px;font-weight:700;color:var(--text-muted);min-width:60px">${dt}</div>
          <div style="flex:1"><div style="font-size:13px;font-weight:700">${OL[insp.occupancy]||insp.occupancy}</div>
            <div style="font-size:11px;color:var(--text-muted)">${insp.signature||'—'} · ${vc} violation(s)</div>
          </div>
          <div class="flex gap6 ac">${vc>0?`<span class="badge bdr">${vc}</span>`:'<span class="badge bdg">✓</span>'}
            <span style="color:var(--text-muted);font-size:16px">›</span>
          </div>
        </div>`;
      }).join('');
  openMo('mo-history');
}

function viewPastReport(inspId) {
  const insp = S.inspections.find(i => i.id === inspId);
  if (!insp) return;
  insp.sections = sectionsForOcc(insp.occupancy);
  const biz = S.businesses.find(b => b.id === insp.bizId);
  if (!biz) return;
  generatePrintReport(insp, biz);
  document.getElementById('past-report-body').innerHTML = document.getElementById('print-report-content').innerHTML;
  document.getElementById('screen-print-report').style.display = 'none';
  closeMo('mo-history');
  openMo('mo-past-report');
}

// ═══════════════════════════════════════════════════════════════
// VIOLATIONS
// ═══════════════════════════════════════════════════════════════
function setViolFilter(filter, el) {
  S.violFilter = filter;
  document.querySelectorAll('#screen-violations .chip').forEach(c => c.classList.remove('sel'));
  el.classList.add('sel');
  renderViols();
}

function renderViols() {
  const q = (document.getElementById('viol-search')?.value || '').toLowerCase();
  const today = new Date();
  let viols = S.violations.filter(v => {
    if (S.violFilter === 'all') return v.status === 'open';
    if (S.violFilter === 'critical') return v.status === 'open' && v.critical;
    if (S.violFilter === 'resolved') return v.status === 'resolved';
    if (S.violFilter === 'overdue') return v.status === 'open' && v.deadlineDate && new Date(v.deadlineDate) < today;
    return v.status === 'open';
  });
  if (q) viols = viols.filter(v => v.bizName?.toLowerCase().includes(q) || v.label?.toLowerCase().includes(q) || v.code?.toLowerCase().includes(q));
  const openCount = S.violations.filter(v => v.status === 'open').length;
  const vc = document.getElementById('vc-badge'); if (vc) vc.textContent = openCount;
  updateViolDot();
  const list = document.getElementById('viol-list');
  if (!viols.length) { list.innerHTML = '<div class="es"><div class="ei">✅</div><p>No violations in this view.</p></div>'; return; }
  list.innerHTML = viols.map(v => {
    const deadline = v.deadlineDate ? new Date(v.deadlineDate) : null;
    const daysLeft = deadline ? Math.ceil((deadline - today) / 86400000) : null;
    let dlClass = '', dlText = '';
    if (deadline && v.status === 'open') {
      if (daysLeft < 0) { dlClass = 'overdue'; dlText = `⏰ OVERDUE by ${Math.abs(daysLeft)}d`; }
      else if (daysLeft <= 7) { dlClass = 'soon'; dlText = `⚠️ ${daysLeft}d remaining`; }
      else { dlClass = 'ok'; dlText = `✓ Due ${deadline.toLocaleDateString()}`; }
    }
    return `<div class="card" style="margin-bottom:9px" onclick="showViolDetail('${v.id}')">
      <div class="vi${v.critical?'':' vi-std'}${v.status==='resolved'?' vi-resolved':''}">
        <div class="vi-hdr">
          <div style="flex:1;min-width:0">
            <div class="vi-title">${v.critical?'★ ':''}${v.label}</div>
            <div style="font-size:11px;color:var(--text-muted);font-weight:600;margin-top:1px">🏢 ${v.bizName}</div>
            <div class="vi-code">${v.code}</div>
            ${v.note ? `<div class="vi-note">📝 ${v.note}</div>` : ''}
            ${dlText ? `<div class="vi-deadline ${dlClass}">${dlText}</div>` : ''}
            <div class="vi-detail">📅 ${new Date(v.date).toLocaleDateString()} · ${v.sectionTitle}</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:5px;align-items:flex-end;flex-shrink:0">
            ${v.critical ? '<span class="badge bdr">CRITICAL</span>' : '<span class="badge bdo">STD</span>'}
            <span class="badge ${v.status==='open'?'bdr':'bdg'}">${v.status==='open'?'OPEN':'RESOLVED'}</span>
            ${v.status==='open' ? `<button class="btn btn-xs btn-green" onclick="event.stopPropagation();resolveViol('${v.id}')">✓ Resolve</button>` : ''}
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
}

function showViolDetail(id) {
  const v = S.violations.find(x => x.id === id); if (!v) return;
  document.getElementById('vd-title').textContent = (v.critical ? '★ ' : '') + v.label;
  const deadline = v.deadlineDate ? new Date(v.deadlineDate) : null;
  document.getElementById('vd-body').innerHTML = `
    <div class="al ${v.critical?'al-red':'al-orange'}"><strong>${v.critical?'Critical':'Standard'} Violation</strong> · ${v.status==='open'?'OPEN':'RESOLVED'}</div>
    <div class="fg"><label>Code Reference</label><div style="font-family:var(--mono);font-size:12px;padding:8px;background:var(--gray-light);border-radius:7px">${v.code}</div></div>
    <div class="fg"><label>Section</label><div style="font-size:13px">${v.sectionTitle}</div></div>
    <div class="fg"><label>Property</label><div style="font-size:13px">${v.bizName}<br><span style="color:var(--text-muted);font-size:11px">${v.bizAddress||''}</span></div></div>
    ${v.note ? `<div class="fg"><label>Inspector Notes</label><div style="font-size:13px;padding:8px;background:var(--orange-light);border-radius:7px">${v.note}</div></div>` : ''}
    ${deadline ? `<div class="fg"><label>Correction Deadline</label><div style="font-size:13px;font-weight:700">${deadline.toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})}</div></div>` : ''}
    <div class="fg"><label>Inspection Date</label><div style="font-size:13px">${new Date(v.date).toLocaleDateString()}</div></div>
    ${v.status==='open' ? `<button class="btn btn-green btn-full mt8" onclick="resolveViol('${v.id}');closeMo('mo-viol-detail')">✓ Mark Resolved</button>` : ''}`;
  openMo('mo-viol-detail');
}

async function resolveViol(id) {
  const v = S.violations.find(x => x.id === id);
  if (v && confirm(`Mark as resolved?\n\n"${v.label.substring(0, 80)}..."`)) {
    await saveDoc('violations', id, { ...v, status: 'resolved', resolvedDate: new Date().toISOString() });
    renderViols(); renderDash();
  }
}

// ═══════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════
function renderDash() {
  const tb = S.businesses.length;
  const ci = S.inspections.filter(i => i.status === 'completed').length;
  const ov = S.violations.filter(v => v.status === 'open').length;
  const cv = S.violations.filter(v => v.status === 'open' && v.critical).length;
  document.getElementById('dash-stats').innerHTML = `
    <div class="sc"><div class="sn" style="color:var(--blue)">${tb}</div><div class="sl">Properties</div></div>
    <div class="sc"><div class="sn" style="color:var(--green)">${ci}</div><div class="sl">Completed</div></div>
    <div class="sc"><div class="sn" style="color:var(--red)">${ov}</div><div class="sl">Open Violations</div></div>
    <div class="sc"><div class="sn" style="color:var(--dark-red)">${cv}</div><div class="sl">Critical</div></div>`;
  const today = new Date();
  const overdue = S.violations.filter(v => v.status === 'open' && v.deadlineDate && new Date(v.deadlineDate) < today);
  const drafts = S.inspections.filter(i => i.status === 'draft');
  let alerts = '';
  if (overdue.length) alerts += `<div class="al al-red">⏰ <div><strong>${overdue.length} overdue violation(s).</strong> <button class="btn btn-xs btn-red no-print" onclick="showScreen('violations');setViolFilter('overdue',document.getElementById('vf-overdue'))">View</button></div></div>`;
  if (drafts.length) alerts += `<div class="al al-orange">📋 <div><strong>${drafts.length} draft inspection(s)</strong> in progress. <button class="btn btn-xs btn-orange no-print" onclick="showScreen('inspection')">Resume</button></div></div>`;
  document.getElementById('dash-alerts').innerHTML = alerts;
  document.getElementById('dash-viol-count').textContent = ov;
  const recent = S.inspections.filter(i => i.status === 'completed').sort((a, b) => new Date(b.completedDate) - new Date(a.completedDate)).slice(0, 5);
  document.getElementById('dash-recent').innerHTML = !recent.length
    ? '<div class="es" style="padding:18px"><p>No completed inspections yet.</p></div>'
    : recent.map(i => {
        const vc = S.violations.filter(v => v.inspectionId === i.id).length;
        return `<div class="bi"><div class="bico">${OI[i.occupancy]||'📋'}</div><div class="binfo"><div class="bname">${i.bizName}</div><div class="baddr">${new Date(i.completedDate).toLocaleDateString()}</div><div class="bmeta"><span class="badge bdb">${OL[i.occupancy]||i.occupancy}</span>${vc>0?`<span class="badge bdr">⚠️ ${vc}</span>`:'<span class="badge bdg">✓</span>'}</div></div></div>`;
      }).join('');
  const rv = S.violations.filter(v => v.status === 'open').sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
  document.getElementById('dash-violations').innerHTML = !rv.length
    ? '<div class="es" style="padding:18px"><div class="ei" style="font-size:32px">✅</div><p>No open violations.</p></div>'
    : rv.map(v => `<div class="vi${v.critical?'':' vi-std'}" onclick="showViolDetail('${v.id}')"><div class="vi-hdr"><div><div class="vi-title" style="font-size:12px">${v.critical?'★ ':''}${v.label}</div><div class="vi-detail">🏢 ${v.bizName} · ${new Date(v.date).toLocaleDateString()}</div></div>${v.critical?'<span class="badge bdr">★</span>':'<span class="badge bdo">STD</span>'}</div></div>`).join('');
}

// ═══════════════════════════════════════════════════════════════
// BUSINESS MANAGEMENT
// ═══════════════════════════════════════════════════════════════
let _bizOccFilter = '';
function filterBizOcc(el, occ) {
  _bizOccFilter = occ;
  document.querySelectorAll('#biz-filter-chips .chip').forEach(c => c.classList.remove('sel'));
  el.classList.add('sel');
  renderBizList();
}

function openAddBiz() {
  S.editBizId = null;
  document.getElementById('biz-mo-title').textContent = '➕ Add Property';
  ['b-name','b-addr','b-contact','b-cemail','b-cphone','b-notes','b-sqft'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const s = S.settings;
  document.getElementById('b-city').value = s.defaultCity || 'Yorktown Heights';
  document.getElementById('b-zip').value = s.defaultZip || '10598';
  document.getElementById('b-occ').value = '';
  document.getElementById('b-sprink').value = 'unknown';
  document.getElementById('b-stories').value = '1';
  document.getElementById('b-ctype').value = '';
  document.getElementById('b-liion').value = 'none';
  openMo('mo-biz');
}

function editBiz(bizId) {
  const biz = S.businesses.find(b => b.id === bizId); if (!biz) return;
  S.editBizId = bizId;
  document.getElementById('biz-mo-title').textContent = '✏️ Edit Property';
  ['name','address','contact','contactEmail','contactPhone','notes','sqft'].forEach((k, i) => {
    const ids = ['b-name','b-addr','b-contact','b-cemail','b-cphone','b-notes','b-sqft'];
    const el = document.getElementById(ids[i]); if (el) el.value = biz[k] || '';
  });
  document.getElementById('b-city').value = biz.city || 'Yorktown Heights';
  document.getElementById('b-zip').value = biz.zip || '10598';
  document.getElementById('b-occ').value = biz.occupancy || '';
  document.getElementById('b-sprink').value = biz.sprinkler || 'unknown';
  document.getElementById('b-stories').value = biz.stories || '1';
  document.getElementById('b-ctype').value = biz.constType || '';
  document.getElementById('b-liion').value = biz.liion || 'none';
  openMo('mo-biz');
}

async function saveBiz() {
  const name = document.getElementById('b-name').value.trim();
  const addr = document.getElementById('b-addr').value.trim();
  const occ = document.getElementById('b-occ').value;
  const contact = document.getElementById('b-contact').value.trim();
  const cemail = document.getElementById('b-cemail').value.trim();
  if (!name || !addr || !occ || !contact || !cemail) { alert('Please fill all required fields.'); return; }
  const id = S.editBizId || 'biz_' + Date.now();
  const biz = {
    id, name, address: addr,
    city: document.getElementById('b-city').value || 'Yorktown Heights',
    zip: document.getElementById('b-zip').value || '10598',
    occupancy: occ, contact, contactEmail: cemail,
    contactPhone: document.getElementById('b-cphone').value,
    sprinkler: document.getElementById('b-sprink').value,
    stories: document.getElementById('b-stories').value,
    sqft: document.getElementById('b-sqft').value,
    constType: document.getElementById('b-ctype').value,
    liion: document.getElementById('b-liion').value,
    notes: document.getElementById('b-notes').value,
    createdAt: S.editBizId ? (S.businesses.find(b => b.id === S.editBizId) || {}).createdAt : new Date().toISOString()
  };
  await saveDoc('businesses', id, biz);
  closeMo('mo-biz');
}

async function delBiz(bizId) {
  if (!confirm('Delete this property and all associated data? This cannot be undone.')) return;
  showSync('saving');
  const batch = FB().writeBatch(db());
  batch.delete(userDoc('businesses', bizId));
  S.inspections.filter(i => i.bizId === bizId).forEach(i => batch.delete(userDoc('inspections', i.id)));
  S.violations.filter(v => v.bizId === bizId).forEach(v => batch.delete(userDoc('violations', v.id)));
  await batch.commit();
  showSync('saved');
}

function renderBizList() {
  const q = (document.getElementById('biz-search')?.value || '').toLowerCase();
  const list = document.getElementById('biz-list');
  if (!list) return;
  let filt = S.businesses.filter(b =>
    b.name?.toLowerCase().includes(q) || b.address?.toLowerCase().includes(q)
  );
  if (_bizOccFilter) filt = filt.filter(b => b.occupancy && b.occupancy.startsWith(_bizOccFilter));
  if (!filt.length) {
    list.innerHTML = `<div class="es"><div class="ei">🏢</div><p>${!S.businesses.length ? 'No properties yet. Tap ＋ Add.' : 'No results.'}</p></div>`;
    return;
  }
  filt.sort((a, b) => a.name.localeCompare(b.name));
  list.innerHTML = filt.map(biz => {
    const last = S.inspections.filter(i => i.bizId === biz.id && i.status === 'completed').sort((a, b) => new Date(b.completedDate) - new Date(a.completedDate))[0];
    const ov = S.violations.filter(v => v.bizId === biz.id && v.status === 'open').length;
    return `<div class="bi" onclick="startInsp('${biz.id}')">
      <div class="bico">${OI[biz.occupancy]||'🏢'}</div>
      <div class="binfo">
        <div class="bname">${biz.name}</div>
        <div class="baddr">${biz.address}, ${biz.city}</div>
        <div class="bmeta">
          <span class="badge bdb">${OL[biz.occupancy]||biz.occupancy}</span>
          ${biz.liion && biz.liion !== 'none' ? '<span class="badge bdp">🔋</span>' : ''}
          ${ov > 0 ? `<span class="badge bdr">⚠️ ${ov}</span>` : '<span class="badge bdg">✓</span>'}
          ${last ? `<span class="badge bdgr">${new Date(last.completedDate).toLocaleDateString()}</span>` : '<span class="badge bdy">Never</span>'}
        </div>
      </div>
      <div class="bi-actions">
        <button class="btn btn-xs btn-blue" onclick="event.stopPropagation();viewHistory('${biz.id}')">📋</button>
        <button class="btn btn-xs btn-outline" onclick="event.stopPropagation();editBiz('${biz.id}')">✏️</button>
        <button class="btn btn-xs btn-gray" onclick="event.stopPropagation();delBiz('${biz.id}')">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════
function loadSettings() {
  const s = S.settings;
  const names = (s.inspectorName || '').split(' ');
  document.getElementById('s-fname').value = names[0] || '';
  document.getElementById('s-lname').value = names.slice(1).join(' ') || '';
  document.getElementById('s-iemail').value = s.inspectorEmail || '';
  document.getElementById('s-iphone').value = s.inspectorPhone || '';
  document.getElementById('s-ibadge').value = s.inspectorBadge || '';
  document.getElementById('s-cert').value = s.inspectorCert || '';
  document.getElementById('s-demail').value = s.deptEmail || '';
  document.getElementById('s-dname').value = s.deptName || '';
  document.getElementById('s-dphone').value = s.deptPhone || '';
  document.getElementById('s-daddr').value = s.deptAddr || '';
  document.getElementById('s-deadline').value = s.defaultDeadlineDays || 30;
  document.getElementById('s-dcity').value = s.defaultCity || 'Yorktown Heights';
  document.getElementById('s-dzip').value = s.defaultZip || '10598';
  const se = document.getElementById('settings-email');
  if (se) se.textContent = window._userEmail || '';
}

async function saveSettings() {
  const fn = document.getElementById('s-fname').value.trim();
  const ln = document.getElementById('s-lname').value.trim();
  Object.assign(S.settings, {
    inspectorName: [fn, ln].filter(Boolean).join(' '),
    inspectorEmail: document.getElementById('s-iemail').value.trim(),
    inspectorPhone: document.getElementById('s-iphone').value.trim(),
    inspectorBadge: document.getElementById('s-ibadge').value.trim(),
    inspectorCert: document.getElementById('s-cert').value,
    deptEmail: document.getElementById('s-demail').value.trim(),
    deptName: document.getElementById('s-dname').value.trim(),
    deptPhone: document.getElementById('s-dphone').value.trim(),
    deptAddr: document.getElementById('s-daddr').value.trim(),
    defaultDeadlineDays: parseInt(document.getElementById('s-deadline').value) || 30,
    defaultCity: document.getElementById('s-dcity').value.trim(),
    defaultZip: document.getElementById('s-dzip').value.trim(),
  });
  await saveDoc('meta', 'settings', S.settings);
  const el = document.getElementById('s-saved');
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}

function exportData() {
  const blob = new Blob([JSON.stringify({ businesses: S.businesses, inspections: S.inspections, violations: S.violations, settings: S.settings }, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `yorktown_fire_${new Date().toISOString().split('T')[0]}.json`;
  a.click(); URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════════
// MODAL HELPERS
// ═══════════════════════════════════════════════════════════════
function openMo(id) { document.getElementById(id).classList.add('open'); }
function closeMo(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.mo').forEach(o => {
  o.addEventListener('click', function(e) { if (e.target === this) closeMo(this.id); });
});
