import { createServer } from "node:net";

// The disposable browser fixture delivers mail only over loopback.
export async function openMailbox() {
  const mail = [];
  const smtp = createServer(socket => {
    socket.setEncoding("utf8");
    socket.write("220 localhost counter test\r\n");
    let buffer = "", data = false, lines = [], recipient = "";
    socket.on("data", chunk => {
      buffer += chunk;
      for (let end; (end = buffer.indexOf("\r\n")) !== -1;) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data && line !== ".") { lines.push(line); continue; }
        if (data) {
          const message = lines.join("\r\n");
          let body = message.slice(message.indexOf("\r\n\r\n") + 4);
          if (/Content-Transfer-Encoding: base64/i.test(message)) body = Buffer.from(body, "base64").toString();
          mail.push({ recipient, body: body.replace(/=\r\n/g, "") });
          data = false;
        } else if (/^RCPT TO:/i.test(line)) {
          recipient = line.toLowerCase();
        } else if (line.toUpperCase() === "DATA") {
          data = true; lines = []; socket.write("354 End with dot\r\n"); continue;
        } else if (line.toUpperCase() === "QUIT") {
          socket.end("221 Bye\r\n"); continue;
        }
        socket.write("250 OK\r\n");
      }
    });
  });
  await new Promise((resolve, reject) => smtp.once("error", reject).listen(10025, "127.0.0.1", resolve));
  return { mail, close: () => smtp.close() };
}
