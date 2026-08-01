// 穿模扫描器（DEV 工具）：程序化逐帧步进 lean 动画，计算手臂段×躯干胶囊的
// 相交深度，输出数字报告——把"穿没穿模"从截图肉眼判断变成可闭环调参的指标。
//
// 用法：DEV 页面控制台整段粘贴执行（依赖 window.__tripo 曝光的 mixer/perfActions）。
// 输出：[{t, pair, pen}]，pen=穿透深度（世界单位）。
// 标定基线：站姿双臂环抱的自然贴胸 ≈0.33（胶囊保守偏大所致），显著高于
// 基线或出现 ×headc（扫头/双马尾）即为可见穿模。
(() => {
  const T = window.__tripo;
  if (!T?.mixer) return { err: "no mixer（需 DEV 构建且模型已加载）" };
  const S = T.scene;
  const bone = (n) => S.getObjectByName(n);
  const P = (b) => {
    const v = new (S.position.constructor)();
    b.getWorldPosition(v);
    return v;
  };
  function segDist(p1, q1, p2, q2) {
    const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2);
    const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
    const c = d1.dot(r), b = d1.dot(d2), den = a * e - b * b;
    let s = den ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
    let t = (b * s + f) / e;
    if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
    else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    return p1.clone().addScaledVector(d1, s).distanceTo(p2.clone().addScaledVector(d2, t));
  }
  const bn = {
    hips: bone("mixamorigHips"), sp1: bone("mixamorigSpine1"), neck: bone("mixamorigNeck"),
    head: bone("mixamorigHead"), lA: bone("mixamorigLeftArm"), lF: bone("mixamorigLeftForeArm"),
    lH: bone("mixamorigLeftHand"), rA: bone("mixamorigRightArm"), rF: bone("mixamorigRightForeArm"),
    rH: bone("mixamorigRightHand"),
  };
  const BODY = [["chest", "sp1", "neck", 0.44], ["belly", "hips", "sp1", 0.36], ["headc", "neck", "head", 0.33]];
  const ARMS = [["L_fore", "lF", "lH", 0.085], ["R_fore", "rF", "rH", 0.085], ["L_up", "lA", "lF", 0.095], ["R_up", "rA", "rF", 0.095]];
  const lb = T.perfActions.leanBody, la = T.perfActions.leanArm;
  const dur = lb.getClip().duration;
  [lb, la].forEach((a) => { a.stop(); a.clampWhenFinished = true; a.reset().play(); a.timeScale = 0; });
  const report = [];
  for (let t = 0; t <= dur + 0.001; t += 0.075) {
    lb.time = t; la.time = t;
    T.mixer.update(0.000001);
    S.updateMatrixWorld(true);
    let worst = null;
    for (const [an, a1, a2, ar] of ARMS) {
      for (const [bnn, b1, b2, br] of BODY) {
        if ((an === "L_up" || an === "R_up") && bnn === "chest") continue; // 上臂根在肩=天然贴胸
        const d = segDist(P(bn[a1]), P(bn[a2]), P(bn[b1]), P(bn[b2]));
        const pen = ar + br - d;
        if (pen > 0 && (!worst || pen > worst.pen)) worst = { pair: `${an}×${bnn}`, pen: +pen.toFixed(3) };
      }
    }
    if (worst) report.push({ t: +t.toFixed(2), ...worst });
  }
  return { dur: +dur.toFixed(2), clipCount: report.length, report };
})();
