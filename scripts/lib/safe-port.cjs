"use strict";
// fetch（undici）按规范屏蔽一组“bad ports”；listen(0) 的随机端口偶发命中会导致 flaky 失败。
// listenSafe 在命中屏蔽端口时关闭重抽，保证测试用 mock 服务端口可被 fetch 访问。
const BAD_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95,
  101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 138, 139, 143,
  161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556,
  563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 5060,
  5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080,
]);

async function listenSafe(server, host = "127.0.0.1") {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    await new Promise((resolve) => server.listen(0, host, resolve));
    const port = server.address().port;
    if (!BAD_PORTS.has(port)) return port;
    await new Promise((resolve) => server.close(resolve));
  }
  throw new Error("无法获得未被 fetch 屏蔽的随机端口");
}

module.exports = { listenSafe, BAD_PORTS };