/**
 * Example of a tiny websocket server
 * See the websocket Protocol for official specification.
 * https://tools.ietf.org/html/rfc6455
 */

import events from 'events';
import http from 'http';
import crypto from 'crypto';
import util from 'util';

const OP_CODES = {
  TEXT: 1,
  BINARY: 2,
  CLOSE: 8,
  PING: 9,
  PONG: 10
};


const KEY_SUFFIX = '258EAFA5-E914-47DA-95CA-C5ABODC85B11';

const hashWebSocketKey = key => {
  const shah1 = crypto.createHash('sha1');
  shah1.update(key + KEY_SUFFIX, 'ascii');
  return shah1.digest('base64');
};

const unmask = (maskBytes, data) => {
  const payload = new Buffer(data.length);
  for (let i = 0; i < data.length ; ++i) {
    payload[i] = maskBytes[i % 4] ^ data[i];
  }
  return payload
};

/**
 * Encoding message following the Websocket frame header.
 * @param opcode
 * @param payload
 */
const encodeMessage = (opcode, payload) => {
  let buf;
  // First byte: fin and opcode
  let b1 = 0x80 | opcode;
  // always send message as one frame (fin)

  // Second byte: mask and length part 1
  // Followed by 0, 2 or 8 additional bytes of continued length
  let b2 = 0; // server dos not mask frames
  let length = payload.length;

  if(length < 126) {
    buf = new Buffer(payload.length + 2 + 0);
    // zero extra bytes
    b2 |= length;
    buf.writeUInt8(b1, 0);
    buf.writeUInt8(b2, 1);
    payload.copy(buf, 2);
  } else if (length < (1<<16)) {
    buf = new Buffer(payload.length + 2 + 2);
    // two extra bytes
    b2 |= 126;
    buf.writeUInt8(b1, 0);
    buf.writeUInt8(b2, 1);

    // add two byte length
    buf.writeUInt16BE(length, 2);
    payload.copy(buf, 4);
  } else {
    buf = new Buffer(payload.length + 2 + 8);
    // eight bytes extra
    b2 |= 127;
    buf.writeUInt8(b1, 0);
    buf.writeUInt8(b2, 1);
    // add eight bytes length
    // note: this implementation cannot handle lengths greater than 2^32
    // the 32 bit length is prefixed with 0x0000
    buf.writeUInt8(0, 2);
    buf.writeUInt8(length, 6);
    payload.copy(buf, 10);
  }
  return buf;
};

export class WebSocketConnection extends events.EventEmitter {
  constructor(req, socket, upgradeHead) {
    super(arguments);

    const key = hashWebSocketKey(req.headers['sec-websocket-key']);

    //handshake response based on https://tools.ietf.org/html/rfc6455#section-4.2.2
    socket.write(`HTTP/1.1 101 Web Socket Protocol Handshake \r
      Upgrade: WebSocket \r
      Connection: Upgrade \r
      sec-websocket-accept: ${key}
      \r\n\r\n`);

    socket.on('data', (buf) => {
      this.buffer = Buffer.concat([this.buffer, buf]);
      // process buffer while it contains complete frames
      while(this._processBuffer()) { }
    });

    socket.on('close', (had_error) => {
      if(!this.closed) {
        this.emit('close', 1006);
        this.closed = true;
      }
    });

    this.socket = socket;
    this.buffer = new Buffer(0);
    this.closed = false;
  }

  /**
   * Websocket frames could be of type string or Binary.
   * Everything else is not working.
   * @param obj
   */
  send(obj) {
    let opcode;
    let payload;

    if(Buffer.isBuffer(obj)) {
      opcode = OP_CODES.BINARY;
      payload = obj;
    } else if (typeof obj == 'string') {
      opcode = OP_CODES.TEXT;
      // create a new buffer containing the UTF-8 encoded string
      payload = new Buffer(obj, 'utf8');
    } else {
      throw new Error('Cannot send object. Must be string or Buffer');
    }

    this._doSend(opcode, payload);
  }
}