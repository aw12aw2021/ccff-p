import net from "net";
import crypto from "crypto";

// 配置
const LISTEN_PORT = 3000;        // 本地监听端口
const UUID = "2523c510-9ff0-415b-9582-93949bfae7e3"; // 你的 VLESS UUID

// Hex → Buffer UUID
const UUID_BUF = Buffer.from(UUID.replace(/-/g, ""), "hex");

const server = net.createServer((client) => {
    let stage = 0; // 0=等待握手, 1=已连接远程

    let remote = null;

    client.on("data", async (chunk) => {
        try {
            // -------------------------
            //  Stage 0: 解析 VLESS 握手
            // -------------------------
            if (stage === 0) {
                if (chunk.length < 1 + 16 + 1) {
                    client.destroy();
                    return;
                }

                const version = chunk[0];          // VLESS version = 0x01
                const clientUUID = chunk.slice(1, 17);

                // 校验 UUID
                if (!clientUUID.equals(UUID_BUF)) {
                    console.log("❌ UUID mismatch");
                    client.destroy();
                    return;
                }

                const optLen = chunk[17];          // 可选部分长度
                const headerLength = 18 + optLen;

                if (chunk.length < headerLength + 4) {
                    client.destroy();
                    return;
                }

                const command = chunk[headerLength]; // CONNECT = 1
                if (command !== 1) {
                    console.log("❌ Only CONNECT=1 supported");
                    client.destroy();
                    return;
                }

                // 地址类型
                const addrType = chunk[headerLength + 1];
                let offset = headerLength + 2;

                let targetHost = "";
                if (addrType === 1) {
                    // IPv4
                    targetHost = `${chunk[offset++]}.${chunk[offset++]}.${chunk[offset++]}.${chunk[offset++]}`;
                } else if (addrType === 2) {
                    // 域名
                    const len = chunk[offset++];
                    targetHost = chunk.slice(offset, offset + len).toString();
                    offset += len;
                } else if (addrType === 3) {
                    // IPv6
                    targetHost = chunk.slice(offset, offset + 16).toString("hex").match(/.{1,4}/g).join(":");
                    offset += 16;
                } else {
                    console.log("❌ Unknown address type");
                    client.destroy();
                    return;
                }

                // 端口
                const targetPort = chunk.readUInt16BE(offset);
                offset += 2;

                console.log(`➡️  VLESS → ${targetHost}:${targetPort}`);

                // 建立到目标的连接
                remote = net.connect(targetPort, targetHost, () => {
                    // VLESS 回发空 Response（必须）
                    const resp = Buffer.from([0x00]);
                    client.write(resp);

                    // 剩余数据转发
                    const remaining = chunk.slice(offset);
                    if (remaining.length) remote.write(remaining);

                    // 进入转发阶段
                    stage = 1;
                });

                // 转发 remote → client
                remote.on("data", data => client.write(data));
                remote.on("close", () => client.end());
                remote.on("error", () => client.destroy());

                return;
            }

            // -------------------------
            //  Stage 1: 转发数据
            // -------------------------
            if (stage === 1 && remote) {
                remote.write(chunk);
            }

        } catch (err) {
            console.log("Error:", err);
            client.destroy();
        }
    });

    client.on("error", () => {
        remote?.destroy();
    });
    client.on("close", () => {
        remote?.destroy();
    });
});

server.listen(LISTEN_PORT, () => {
    console.log(`VLESS TCP Server running on :${LISTEN_PORT}`);
});
