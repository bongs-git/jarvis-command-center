import { createServer } from "node:net";
import { writeFileSync } from "node:fs";
const out = process.env.LAB_DIR;
createServer((socket) => {
  let buffer = "", data = false, body = [], recipient = "";
  socket.write("220 local.test ESMTP\r\n");
  socket.on("data", (chunk) => {
    buffer += chunk.toString();
    let pos;
    while ((pos = buffer.indexOf("\r\n")) >= 0) {
      const line = buffer.slice(0, pos);
      buffer = buffer.slice(pos + 2);
      if (data) {
        if (line !== ".") {
          body.push(line);
          continue;
        }
        data = false;
        writeFileSync(out + "/" + recipient + ".eml", body.join("\n"));
        body = [];
        socket.write("250 OK\r\n");
        continue;
      }
      if (/^EHLO|^HELO/i.test(line)) socket.write("250 local.test\r\n");
      else if (/^RCPT TO:/i.test(line)) {
        recipient = line.match(/([A-Za-z0-9]+)@local\.test/i)?.[1] ?? "unknown";
        socket.write("250 OK\r\n");
      } else if (/^DATA/i.test(line)) {
        data = true;
        socket.write("354 Send message\r\n");
      } else if (/^QUIT/i.test(line)) socket.end("221 Bye\r\n");
      else socket.write("250 OK\r\n");
    }
  });
}).listen(55436, "127.0.0.1");
