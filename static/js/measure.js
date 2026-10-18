/* ===========================================================================
   measure.js = 測定（①）の処理。画面には一切触らない。
   ---------------------------------------------------------------------------
   ▼ 中身
     DetherMeter  … マイクから「推定dB」を100msごとに読む道具
     DetherSurvey … 調査の進行役。いつも測り続けて今の音量を流し、
                    しきい値を超えたら判定を始め、結果をサーバーに送る

   ▼ 調査の流れ
     通常の測定 … 今の音量（直近1秒のLeq）を100msごとに画面へ流す。10秒ごとに記録を送る（ヒートマップの材料）
       判定開始の合図は100msごとの値（一瞬でも超えたら始める）
       ├ 70dB以上 → 「大きい音」の判定を開始（10秒）
       └ 40dB未満 → 「静寂」の判定を開始（15秒）
                    この調査で静寂バッジを取った後は、35dB未満で「深い静寂」（15秒）
     判定中 … 判定を始めた時点からの区間を測る。取り消しは「判定を始めてからの直近1秒のLeq」で決める
       ├ 大きい音：70未満が2秒続いた（拍手の切れ目など一瞬の途切れでは取り消さない）
       ├ 静寂：40を超えた / 深い静寂：35を超えた（すぐ取り消す。Leqの判定はどうせ通らないため）
       │   → 判定を取り消して、通常の測定に戻る（測った分は通常の記録として送る）
       └ 時間いっぱい続いた → 区間のLeqをサーバーに送って判定してもらう → 通常の測定に戻る
     新しいバッジが出たら一時停止（マイクも止める）。ポップアップを閉じたら resume() で再開

   ▼ 画面側（④）との約束
     ・このファイルはDOMを触らない。結果はすべてイベントで渡す
     ・画面側は survey.on("イベント名", 関数) で受け取って描画する
     ・バッジのポップアップを閉じたら survey.resume() を呼ぶ（ボタンの処理の中で）

   ▼ 使い方（調査ページのJS）
       const survey = new DetherSurvey();
       survey.on("level",        (e) => { 数字とバーを更新 });
       survey.on("judge-start",  (e) => { 「静寂バッジに挑戦中」などを出す });
       survey.on("judge-cancel", (e) => { 「取り消し」を出す });
       survey.on("badge",        (e) => { 獲得ポップアップを開く（測定は自動で一時停止中） });
       survey.on("error",        (e) => { e.detail.message を出す });
       startButton.onclick = () => survey.start();   // ★必ずボタンの処理の中で呼ぶ
       closeButton.onclick = () => survey.resume();  // ★これもボタンの処理の中で
       stopButton.onclick  = () => survey.stop();

   ▼ イベント一覧（e.detail の中身）
     state        { state }  idle / starting / measuring / paused / interrupted / stopped
     level        { db, level, mode, elapsed, target, segmentLeq, guide, spectrum }   100msごと
                    db         … いまの値（100ms）
                    level      … 今の音量（直近1秒のLeq）。大きく表示するならこちら
                    mode       … "normal"（通常）/ "loud"（大きい音を判定中）/ "quiet"（静寂を判定中）/ "deep"（深い静寂を判定中）
                    elapsed / target … いまの区間の経過秒数 / 長さ（通常10、大きい音10、静寂15、深い静寂15）
                    segmentLeq … いまの区間のLeq
                    guide      … true のとき「音の発生源に近づいてみよう」を出す
                    spectrum   … 今の音の形（直近1秒。0〜1 が16個）。調査画面の砂の板に使う。取れなければ null
     judge-start  { mode, target }     判定を始めた
     judge-cancel { mode, elapsed }    音量が通常に戻ったので判定を取り消した
     warning      { db }               85dB以上が続いている（耳を守る案内。10秒に1回まで）
     round        { result }           区間が終わって送る（result.judge が "loud"/"quiet" なら判定つき）
                    result.spectrum … 音の形（0〜1 が16個。低音→高音）。バッジの「音の標本」の模様に使う
                    （DetherBadge.medal の opt.spectrum に渡す）。帯ごとの強さの平均だけで、音声は残さない
     recorded     { result, response, badge, already, timeBand }   記録した。新しいバッジではない
     badge        { result, response, badge, name, replaced, timeBand }  新しいバッジ！ 一時停止中
                    timeBand = { id, name, code }（id は TimeBand.id。code は TimeBand.code の "d" / "n"）
     error        { code, message }    code: insecure / mic-denied / mic-missing / mic-failed /
                                             location-denied / no-location / send-failed / rate-limited / mic-silent

   ▼ 音声について
     音量の数値だけを計算し、音声そのものは保存も送信もしない（MediaRecorderは使わない）。
     測定が終わったら、マイクは必ず止める（スマホのマイク使用中マークが消える）。
   =========================================================================== */

(function (global) {
  "use strict";

  /* ---------- 調整する数値はここだけ ---------- */
  const CONFIG = {
    // 補正値：推定dB = dBFS + この値。端末の種類ごとに分ける（どれに当たるかは deviceKind()）
    // ★PC（開発中にバッジの基準を合わせた端末）を基準にする。
    //   iPhone 15 Pro は同じ音でPCより約20dB低く出た。+20 だと高すぎたので +10 にしている。
    //   Android はまだ比べていないのでPCと同じ値
    calibration: { ios: 104, android: 94, desktop: 94 },
    // 表示・計算に使う下限と上限（スマホのマイクはこの外を正確に測れない）
    floorDb: 20,
    ceilDb: 130,
    // 通常の測定：この秒数ごとに記録を送る
    roundSeconds: 10,
    // 大きい音：100msの値がこれ以上で判定開始。この秒数のLeqで判定
    loudDb: 70,
    loudSeconds: 10,
    // 大きい音の判定中、直近1秒のLeqが loudDb 未満の状態がこの秒数続いたら取り消す
    loudCancelSeconds: 2,
    // 静寂：100msの値がこれ未満で判定開始。直近1秒のLeqがこれを超えたら取り消す。この秒数のLeqで判定
    quietDb: 40,
    quietSeconds: 15,
    // 深い静寂（この調査で静寂バッジを取った後）。決まりは静寂と同じ
    deepDb: 35,
    deepSeconds: 15,
    // 「今の音量」と取り消しの判断を何ms分のLeqで見るか
    levelWindowMs: 1000,
    // これより短い区間は送らない（判定開始の直後に取り消した場合など）
    minSendSeconds: 5,
    // 発生源への誘導：区間の最初の1秒と直近1秒の平均の差がこれ以上なら案内
    guideRiseDb: 2.5,
    // 85dB警告：今の音量がこれ以上で出す
    warningDb: 85,
    warningIntervalMs: 10000,
    // 何msごとに音量を読むか
    tickMs: 100,
    // 音の形（音の標本）：低音〜高音をこの数の帯に分けて強さを取る。帯の幅は音の高さの感じ方に合わせて対数で等分
    spectrumBands: 16,
    spectrumMinHz: 60,
    spectrumMaxHz: 12000,
    // 一番強い帯からこのdB下までを 0〜1 に直す（それより弱い帯は 0）
    spectrumRangeDb: 40,
    // 測定を送るURL（docs/API_measurement.md と合わせる）
    apiUrl: "/api/measurements",
  };

  const NAMES = { b90: "90dBバッジ", b80: "80dBバッジ", b70: "70dBバッジ", q40: "静寂バッジ", q35: "深い静寂バッジ" };
  // 同じ系統の中での強さ（左ほど強い）。モックと同じ
  const RANK = ["b90", "b80", "b70", "q35", "q40"];
  const seriesOf = (code) => (code && code[0] === "b" ? "loud" : "quiet");

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const energy = (db) => Math.pow(10, db / 10);
  const leq = (sumE, n) => (n > 0 ? 10 * Math.log10(sumE / n) : NaN);
  const round1 = (v) => Math.round(v * 10) / 10;

  /* =========================================================================
     DetherMeter：マイク → 推定dB
     ========================================================================= */
  class DetherMeter {
    /**
     * @param {Object} [opt]
     * @param {number} [opt.calibration]  補正値（省略時は CONFIG.calibration のこの端末の値）
     * @param {Function} [opt.simulate]   マイクの代わりに dB を返す関数（PCでの開発用）
     */
    constructor(opt) {
      const o = opt || {};
      this.calibration = o.calibration != null ? Number(o.calibration) : CONFIG.calibration[deviceKind()];
      this.simulate = typeof o.simulate === "function" ? o.simulate : null;
      this.ctx = null;
      this.stream = null;
      this.analyser = null;
      this.source = null;
      this.buf = null;
      this.freqBuf = null;
    }

    get isOpen() {
      return !!(this.simulate || this.stream);
    }

    /** ブラウザがマイクを使える状態か（httpsでないとスマホでは使えない） */
    static supported() {
      return !!(global.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    }

    /**
     * マイクを開く。★ボタンを押した処理の中で呼ぶ（iPhoneの決まり）
     * 失敗したら Error（name: NotAllowedError など）を投げる
     */
    async open() {
      if (this.simulate) return;
      if (!DetherMeter.supported()) {
        const err = new Error("insecure");
        err.name = "InsecureContextError";
        throw err;
      }
      // ★AudioContext は await より前に作る/再開する（iPhoneはボタン操作の直後でないと鳴らない）
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!this.ctx || this.ctx.state === "closed") this.ctx = new AC();
      const resuming = this.ctx.state === "suspended" ? this.ctx.resume() : null;

      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // 音量を正しく測るため、ブラウザの自動補正はすべてオフ
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
      });
      if (resuming) await resuming;

      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 4096; // 48kHzで約85ms分。100msごとに読むので取りこぼしが少ない
      this.source = this.ctx.createMediaStreamSource(this.stream);
      this.source.connect(this.analyser); // スピーカーには繋がない（ハウリングしない）
      this.buf = new Float32Array(this.analyser.fftSize);
      this.freqBuf = new Float32Array(this.analyser.frequencyBinCount);
    }

    /**
     * いまの音の形を1つ読む（音の標本用）。帯ごとの強さ（エネルギー。dBではない）の配列。
     * ★音そのものではなく帯ごとの強さだけなので、会話の中身は元に戻せない
     * @param {number} level  read() で読んだいまの推定dB（シミュレーションのときに使う）
     */
    readSpectrum(level) {
      if (this.simulate) return fakeSpectrum(level);
      if (!this.analyser || !this.freqBuf) return null;
      this.analyser.getFloatFrequencyData(this.freqBuf); // 周波数ごとの強さ（dBFS）
      const binHz = this.ctx.sampleRate / this.analyser.fftSize;
      const n = CONFIG.spectrumBands;
      const out = new Array(n).fill(0);
      for (let b = 0; b < n; b++) {
        const lo = CONFIG.spectrumMinHz * Math.pow(CONFIG.spectrumMaxHz / CONFIG.spectrumMinHz, b / n);
        const hi = CONFIG.spectrumMinHz * Math.pow(CONFIG.spectrumMaxHz / CONFIG.spectrumMinHz, (b + 1) / n);
        const i0 = Math.max(1, Math.floor(lo / binHz));
        const i1 = Math.min(this.freqBuf.length - 1, Math.max(i0, Math.ceil(hi / binHz) - 1));
        let sum = 0;
        for (let i = i0; i <= i1; i++) {
          const db = this.freqBuf[i];
          if (Number.isFinite(db)) sum += energy(db);
        }
        out[b] = sum / (i1 - i0 + 1);
      }
      return out;
    }

    /** いまの推定dBを1つ読む */
    read() {
      if (this.simulate) return clamp(Number(this.simulate()) || CONFIG.floorDb, CONFIG.floorDb, CONFIG.ceilDb);
      if (!this.analyser) return NaN;
      this.analyser.getFloatTimeDomainData(this.buf);
      let sum = 0;
      for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
      const rms = Math.sqrt(sum / this.buf.length);
      // 完全な無音（0が並ぶ）は、マイクが音を届けていない状態。静寂として数えないよう「読めない」扱い
      if (rms < 1e-7) return NaN;
      const dbfs = 20 * Math.log10(Math.max(rms, 1e-10));
      return clamp(dbfs + this.calibration, CONFIG.floorDb, CONFIG.ceilDb);
    }

    /** マイクを止める（使用中マークが消える）。AudioContext は再開用に残す */
    close() {
      if (this.source) {
        try { this.source.disconnect(); } catch (e) { /* 既に切れている */ }
      }
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
      this.source = null;
      this.analyser = null;
      this.freqBuf = null;
      if (this.ctx && this.ctx.state === "running") this.ctx.suspend().catch(() => {});
    }

    /** ページを離れるときなど、完全に片付ける */
    dispose() {
      this.close();
      if (this.ctx && this.ctx.state !== "closed") this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }

  /* =========================================================================
     DetherSurvey：調査の進行役
     ========================================================================= */
  class DetherSurvey extends EventTarget {
    /**
     * @param {Object} [opt]
     * @param {number}   [opt.calibration]  補正値
     * @param {Function} [opt.simulate]     マイクの代わりに dB を返す関数（開発用）
     * @param {Function|null} [opt.send]    送信の関数 payload => Promise<response>。
     *                                      省略時はサーバーへPOST。null ならサーバーに送らず手元で判定（開発用）
     * @param {boolean}  [opt.useLocation=true]  位置情報を使う（false は開発用。東京駅の座標を入れる）
     * @param {number}   [opt.timeScale=1]  時間の進み方（開発用。10 にすると15秒の静寂が1.5秒で試せる）
     */
    constructor(opt) {
      super();
      const o = opt || {};
      this.meter = new DetherMeter({ calibration: o.calibration, simulate: o.simulate });
      this.send = o.send === undefined ? defaultSend : o.send;
      this.useLocation = o.useLocation !== false;
      this.indoor = !!o.indoor; // 屋内で測っているか。送る記録に付ける（setIndoor で切り替える）
      this.timeScale = Number(o.timeScale) > 0 ? Number(o.timeScale) : 1;

      this.state = "idle";
      this.position = null;
      this.watchId = null;
      this.timer = null;
      this.sessionBest = {}; // この調査で取った一番強いバッジ（系統ごと）
      this.sessionCount = 0;
      this.lastWarningAt = 0;
      this.recent = []; // 「今の音量」用の直近の値
      this.recentSpec = []; // 「今の音の形」用の直近の帯ごとの強さ
      this.seg = null; // いまの区間
      this.lastAt = 0;
      this.deadMs = 0; // マイクから音が届いていない時間
      this.deadWarned = false;

      this._onVisibility = () => {
        if (document.visibilityState === "hidden") this._interrupt();
      };
      this._onPageHide = () => this.stop();
    }

    /** survey.on("level", fn) の短い書き方。外すときは戻り値の関数を呼ぶ */
    on(type, fn) {
      const h = (e) => fn(e);
      this.addEventListener(type, h);
      return () => this.removeEventListener(type, h);
    }

    /* ---------- 画面から呼ぶ操作 ---------- */

    /** 調査を始める。★ボタンの処理の中で呼ぶ */
    async start() {
      if (this.state !== "idle" && this.state !== "stopped") return;
      this.sessionBest = {};
      this.sessionCount = 0;
      this._setState("starting");
      try {
        await this.meter.open();
      } catch (err) {
        this._setState("stopped");
        this._error(micErrorCode(err));
        return;
      }
      this._watchLocation();
      document.addEventListener("visibilitychange", this._onVisibility);
      global.addEventListener("pagehide", this._onPageHide);
      this._run();
    }

    /** ポップアップを閉じたとき、または中断から戻るときに呼ぶ。★ボタンの処理の中で */
    async resume() {
      if (this.state !== "paused" && this.state !== "interrupted") return;
      this._setState("starting");
      try {
        await this.meter.open();
      } catch (err) {
        this._setState("stopped");
        this._error(micErrorCode(err));
        return;
      }
      this._run();
    }

    /**
     * 屋外／屋内を切り替える。調査中なら、測りかけの区間は捨てて測り直す
     * （屋外の音と屋内の音が1つの記録に混ざらないように）
     */
    setIndoor(indoor) {
      const next = !!indoor;
      if (next === this.indoor) return;
      this.indoor = next;
      if (this.state === "measuring") this._run();
    }

    /** 画面側の都合で止めたいとき（例：投稿ポップアップを開く）。マイクも止まる */
    pause() {
      if (this.state !== "measuring") return;
      this._halt("paused");
    }

    /** 調査を終える。測りかけの区間は捨てる */
    stop() {
      if (this.state === "idle" || this.state === "stopped") return;
      this._halt("stopped");
      this._unwatch();
    }

    /* ---------- 中の処理 ---------- */

    /** 通常の測定から始める（止まっていた間の音は分からないので、今の音量も数え直し） */
    _run() {
      this.recent = [];
      this.recentSpec = [];
      this.deadMs = 0;
      this.deadWarned = false;
      this._openSegment("normal");
      this.lastAt = performance.now();
      this._setState("measuring");
      this._stopTicking();
      this.timer = global.setInterval(() => this._tick(), CONFIG.tickMs);
    }

    /** 測定を止める。測りかけの区間は捨てる */
    _halt(state) {
      this._stopTicking();
      this.meter.close();
      this.seg = null;
      this._setState(state);
    }

    _stopTicking() {
      if (this.timer) global.clearInterval(this.timer);
      this.timer = null;
    }

    _targetOf(mode) {
      if (mode === "loud") return CONFIG.loudSeconds;
      if (mode === "quiet") return CONFIG.quietSeconds;
      if (mode === "deep") return CONFIG.deepSeconds;
      return CONFIG.roundSeconds;
    }

    _openSegment(mode) {
      this.seg = {
        mode,
        target: this._targetOf(mode),
        elapsed: 0,
        n: 0,
        sumE: 0,
        max: -Infinity,
        readings: [], // 100msごとの値（誘導・取り消しの判定用）
        belowSeconds: 0, // 大きい音の判定中、70未満が続いている秒数
        specE: new Array(CONFIG.spectrumBands).fill(0), // 音の形：帯ごとの強さの合計
        specN: 0,
        startedAt: new Date(),
      };
    }

    /** 100msの値から、始める判定を決める。無ければ null */
    _triggerFor(L) {
      if (L >= CONFIG.loudDb) return "loud";
      // この調査で静寂バッジを取った後は、深い静寂に挑戦する
      if (this.sessionBest.quiet) return L < CONFIG.deepDb ? "deep" : null;
      return L < CONFIG.quietDb ? "quiet" : null;
    }

    /**
     * 判定中に、音量が通常に戻ったか。
     * 判定を始めてからの直近1秒のLeqで見る（始める前の音は混ぜない）
     */
    _isBackToNormal(s, dt, windowSize) {
      const tail = s.readings.slice(-windowSize);
      const level = leq(tail.reduce((a, v) => a + energy(v), 0), tail.length);
      if (s.mode === "loud") {
        s.belowSeconds = level < CONFIG.loudDb ? s.belowSeconds + dt : 0;
        return s.belowSeconds >= CONFIG.loudCancelSeconds - 1e-6;
      }
      if (s.mode === "quiet") return level > CONFIG.quietDb;
      if (s.mode === "deep") return level > CONFIG.deepDb;
      return false;
    }

    _tick() {
      if (this.state !== "measuring" || !this.seg) return;
      const now = performance.now();
      const gap = now - this.lastAt;
      this.lastAt = now;
      // 1秒以上止まっていた（画面ロック・タブ切替など）→ 測りかけの区間は無効
      if (gap > 1000) {
        this._interrupt();
        return;
      }
      const dt = Math.min(gap, 250) / 1000 * this.timeScale;
      const L = this.meter.read();
      if (!Number.isFinite(L)) {
        // マイクから音が届かない状態が3秒続いたら知らせる（ミュート・ほかのアプリが使用中など）
        this.deadMs += gap;
        if (this.deadMs > 3000 && !this.deadWarned) { this.deadWarned = true; this._error("mic-silent"); }
        return;
      }
      this.deadMs = 0;

      const s = this.seg;
      s.elapsed += dt;
      s.n += 1;
      s.sumE += energy(L);
      s.max = Math.max(s.max, L);
      s.readings.push(L);
      const spec = this.meter.readSpectrum(L);
      if (spec) {
        for (let b = 0; b < spec.length; b++) s.specE[b] += spec[b];
        s.specN += 1;
      }

      // 今の音量（直近1秒のLeq）
      const windowSize = Math.max(1, Math.round(CONFIG.levelWindowMs / CONFIG.tickMs));
      this.recent.push(L);
      if (this.recent.length > windowSize) this.recent.shift();
      // 今の音の形（直近1秒）。調査画面の砂の板を動かす
      if (spec) {
        this.recentSpec.push(spec);
        if (this.recentSpec.length > windowSize) this.recentSpec.shift();
      }
      const specSum = new Array(CONFIG.spectrumBands).fill(0);
      for (const sp of this.recentSpec) for (let b = 0; b < sp.length; b++) specSum[b] += sp[b];
      const level = leq(this.recent.reduce((a, v) => a + energy(v), 0), this.recent.length);
      const levelReady = this.recent.length >= windowSize;

      // 85dB警告
      if (levelReady && level >= CONFIG.warningDb && now - this.lastWarningAt > CONFIG.warningIntervalMs) {
        this.lastWarningAt = now;
        this._emit("warning", { db: round1(level) });
      }

      // 発生源への誘導（区間の最初の1秒と直近1秒を比べる。3秒たってから）
      let guide = false;
      if (s.readings.length >= 30) {
        guide = avg(s.readings.slice(-10)) - avg(s.readings.slice(0, 10)) > CONFIG.guideRiseDb;
      }

      this._emit("level", {
        db: round1(L),
        level: round1(level),
        mode: s.mode,
        elapsed: round1(Math.min(s.elapsed, s.target)),
        target: s.target,
        segmentLeq: round1(leq(s.sumE, s.n)),
        guide,
        spectrum: spectrumShape(specSum, this.recentSpec.length),
      });

      if (s.mode === "normal") {
        const trigger = this._triggerFor(L);
        if (trigger) {
          // しきい値を超えた → ここまでを通常の記録として締めて、判定を始める
          this._closeSegment(null);
          this._openSegment(trigger);
          this._emit("judge-start", { mode: trigger, target: this.seg.target });
          return;
        }
        if (s.elapsed >= s.target - 1e-6) {
          this._closeSegment(null);
          this._openSegment("normal");
        }
        return;
      }

      // 判定中
      if (this._isBackToNormal(s, dt, windowSize)) {
        // 通常に戻った → 判定は取り消し。測った分は通常の記録として送る
        this._emit("judge-cancel", { mode: s.mode, elapsed: round1(s.elapsed) });
        this._closeSegment(null);
        this._openSegment("normal");
        return;
      }
      if (s.elapsed >= s.target - 1e-6) {
        // 時間いっぱい続いた → 判定つきで送る
        this._closeSegment(s.mode === "loud" ? "loud" : "quiet");
        this._openSegment("normal");
      }
    }

    /**
     * いまの区間を締めて送る。judge は "loud" / "quiet"（判定してほしい）か null（通常の記録）
     * 送信は待たない（その間も測定と画面の更新を続ける）
     */
    _closeSegment(judge) {
      const s = this.seg;
      if (!s || s.n === 0) return;
      if (!judge && s.elapsed < CONFIG.minSendSeconds) return; // 短すぎる区間は送らない
      const result = {
        avgDb: round1(leq(s.sumE, s.n)),
        maxDb: round1(s.max),
        durationSeconds: round1(s.elapsed),
        judge,
        mode: s.mode,
        spectrum: spectrumShape(s.specE, s.specN), // 音の形（0〜1 が16個。低音→高音）。取れなければ null
        startedAt: s.startedAt,
        endedAt: new Date(),
      };
      result.candidate = judgeLocally(result); // 手元での目安（本当の判定はサーバー）
      this._emit("round", { result });
      this._sendResult(result);
    }

    async _sendResult(result) {
      const pos = this.position;
      if (!pos) {
        this._error("no-location");
        return;
      }
      const payload = {
        avg_db: result.avgDb,
        max_db: result.maxDb,
        duration_seconds: result.durationSeconds,
        judge: result.judge,
        latitude: pos.latitude,
        longitude: pos.longitude,
        gps_accuracy: pos.accuracy,
        measured_at: isoLocal(result.endedAt),
        spectrum: result.spectrum, // 音の形。後からバッジの模様を描くために保存する
        indoor: this.indoor, // 屋外／屋内（ヒートマップで使う）
      };

      let response;
      try {
        response = this.send ? await this.send(payload) : localResponse(result);
      } catch (err) {
        const code = err && err.status === 429 ? "rate-limited" : "send-failed";
        this._error(code, err && err.message);
        return;
      }
      this.sessionCount += 1;

      const badge = response && response.badge ? response.badge.code : null;
      const timeBand = response && response.measurement ? response.measurement.time_band : null;
      const series = badge ? seriesOf(badge) : null;
      const prev = series ? this.sessionBest[series] : null;
      const isNew = !!badge && (!prev || RANK.indexOf(badge) < RANK.indexOf(prev));

      if (isNew) {
        this.sessionBest[series] = badge;
        // ★ポップアップ表示中は測定しない。マイクも止める（終了済みならそのまま）
        if (this.state === "measuring") this._halt("paused");
        this._emit("badge", {
          result, response, badge,
          name: NAMES[badge],
          replaced: response.badge.replaced || null,
          timeBand,
        });
      } else {
        this._emit("recorded", { result, response, badge, already: !!badge, timeBand });
      }
    }

    /** 画面ロック・タブ切替：測りかけの区間は捨ててマイクを止める。戻ったら resume() で再開 */
    _interrupt() {
      if (this.state !== "measuring") return;
      this._halt("interrupted");
    }

    _watchLocation() {
      if (!this.useLocation) {
        this.position = { latitude: 35.681236, longitude: 139.767125, accuracy: 10 }; // 開発用（東京駅）
        return;
      }
      if (!navigator.geolocation) { this._error("location-denied"); return; }
      this.watchId = navigator.geolocation.watchPosition(
        (p) => {
          this.position = { latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy };
        },
        (err) => {
          if (err.code === 1) this._error("location-denied");
          // それ以外（一時的に取れない）は次の区間で再挑戦
        },
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
      );
    }

    _unwatch() {
      if (this.watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
      document.removeEventListener("visibilitychange", this._onVisibility);
      global.removeEventListener("pagehide", this._onPageHide);
    }

    _setState(state) {
      if (this.state === state) return;
      this.state = state;
      this._emit("state", { state });
    }

    _emit(type, detail) {
      this.dispatchEvent(new CustomEvent(type, { detail }));
    }

    _error(code, message) {
      this._emit("error", { code, message: message || ERROR_TEXT[code] || "測定でエラーが起きました。" });
    }
  }

  /* ---------- 小さな道具 ---------- */

  const ERROR_TEXT = {
    "insecure": "この接続ではマイクを使えません。https のURLで開いてください。",
    "mic-denied": "マイクの使用が許可されていません。ブラウザの設定でマイクを許可してください。",
    "mic-missing": "マイクが見つかりませんでした。",
    "mic-failed": "マイクを開けませんでした。ほかのアプリがマイクを使っていないか確認してください。",
    "location-denied": "位置情報が許可されていません。ブラウザの設定で位置情報を許可してください。",
    "no-location": "位置情報を取得中です。少し待ってから、もう一度測ってください。",
    "send-failed": "記録を送れませんでした。電波の良い場所で、もう一度試してください。",
    "rate-limited": "測定の回数が多すぎます。少し待ってから、もう一度試してください。",
    "mic-silent": "マイクから音が届いていません。マナーモードやほかのアプリのマイク使用を確認してください。",
  };

  function micErrorCode(err) {
    const n = err && err.name;
    if (n === "InsecureContextError") return "insecure";
    if (n === "NotAllowedError" || n === "SecurityError") return "mic-denied";
    if (n === "NotFoundError" || n === "OverconstrainedError") return "mic-missing";
    return "mic-failed";
  }

  /**
   * 区間の帯ごとの強さの合計 → 音の形（0〜1）。一番強い帯が 1、それより spectrumRangeDb 以上弱い帯は 0。
   * 大きさではなく「形」だけにするので、同じ場所なら端末や音量が少し違っても似た形になる
   */
  function spectrumShape(sumE, n) {
    if (!n) return null;
    const db = sumE.map((e) => (e > 0 ? 10 * Math.log10(e / n) : -Infinity));
    const top = Math.max.apply(null, db);
    if (!Number.isFinite(top)) return null;
    const range = CONFIG.spectrumRangeDb;
    return db.map((v) => Math.round(clamp((v - (top - range)) / range, 0, 1) * 100) / 100);
  }

  /** シミュレーション（マイクなし）用の音の形。音量で形が変わり、少し揺らぐ */
  function fakeSpectrum(level) {
    const n = CONFIG.spectrumBands;
    const out = new Array(n);
    // 大きい音ほど低音が強い・静かなほど平ら、のような形にする。山の位置も音量で動かす
    const tilt = level >= 70 ? -2.2 : -0.6;
    const peak = Math.floor(((level - 30) / 70) * n) % n;
    for (let b = 0; b < n; b++) {
      const bump = 12 * Math.exp(-Math.pow((b - (n - 1 - peak)) / 1.6, 2));
      const noise = (Math.random() * 2 - 1) * 2;
      out[b] = energy(level + tilt * b + bump + noise);
    }
    return out;
  }

  /** 補正値を選ぶための端末の種類："ios" / "android" / "desktop" */
  function deviceKind() {
    const ua = navigator.userAgent || "";
    // ★iPadOS のSafariは Mac と名乗るので、タッチできるかで見分ける
    if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
    if (/Android/.test(ua)) return "android";
    return "desktop";
  }

  function avg(arr) {
    if (!arr.length) return NaN;
    let s = 0;
    for (const v of arr) s += v;
    return s / arr.length;
  }

  /** 端末の時刻をタイムゾーン付きで（例：2026-10-17T11:02:33+09:00） */
  function isoLocal(d) {
    const p = (v) => String(v).padStart(2, "0");
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? "+" : "-";
    const oh = p(Math.floor(Math.abs(off) / 60));
    const om = p(Math.abs(off) % 60);
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${sign}${oh}:${om}`;
  }

  /** 手元での判定（サーバーの既定のルールと同じ。表示の目安と、送信なしの開発用） */
  function judgeLocally(res) {
    const eps = 0.2;
    const dur = res.durationSeconds;
    if (res.judge === "quiet") {
      if (dur >= CONFIG.deepSeconds - eps && res.avgDb <= CONFIG.deepDb) return "q35";
      if (dur >= CONFIG.quietSeconds - eps && res.avgDb <= CONFIG.quietDb) return "q40";
      return null;
    }
    if (res.judge === "loud" && dur >= CONFIG.loudSeconds - eps) {
      if (res.avgDb >= 90) return "b90";
      if (res.avgDb >= 80) return "b80";
      if (res.avgDb >= 70) return "b70";
    }
    return null;
  }

  /** send: null のときの、サーバーの返事のまね */
  function localResponse(res) {
    const h = res.endedAt.getHours();
    const day = h >= 6 && h < 22;
    const code = judgeLocally(res);
    return {
      measurement: {
        id: null,
        avg_db: res.avgDb,
        max_db: res.maxDb,
        duration_seconds: res.durationSeconds,
        time_band: { id: null, name: day ? "昼" : "夜", code: day ? "d" : "n" },
      },
      badge: code ? { code, name: NAMES[code], user_badge_id: null, replaced: null } : null,
      saved: false,
    };
  }

  /* ---------- サーバーへの送信 ---------- */
  // ★main.js の api.post とほぼ同じ。違いは、サーバーが返した新しい整理券（csrf_token）を覚えること。
  //   見えないアカウントを作った直後はDjangoが整理券を作り直すので、古い整理券のままだと
  //   2回目の送信が 403 になるため。
  let csrfToken = null;
  function readCsrf() {
    if (csrfToken) return csrfToken;
    const meta = document.querySelector('meta[name="csrf-token"]');
    if (meta && meta.content) return meta.content;
    const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }

  async function defaultSend(payload) {
    const res = await fetch(CONFIG.apiUrl, {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-CSRFToken": readCsrf() },
      body: JSON.stringify(payload),
    });
    let body = null;
    try { body = await res.json(); } catch (e) { body = null; }
    if (body && body.csrf_token) csrfToken = body.csrf_token;
    if (!res.ok) {
      const err = new Error((body && body.error) || `通信に失敗しました (ステータス: ${res.status})`);
      err.status = res.status;
      throw err;
    }
    return body;
  }

  global.DetherMeter = DetherMeter;
  global.DetherSurvey = DetherSurvey;
  global.DetherMeasure = { CONFIG, NAMES, RANK, judgeLocally, isoLocal };
})(window);
