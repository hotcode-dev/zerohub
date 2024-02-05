/* eslint-disable */
import * as _m0 from "protobufjs/minimal";

export const protobufPackage = "";

/** Peer includes peer infomation and peer metadata */
export interface Peer {
  id: number;
  metaData: string;
  joinedAt: number;
}

/** HubInfoMessage includes hub infomation */
export interface HubInfoMessage {
  id: string;
  createdAt: number;
  myPeerID: number;
  peers: Peer[];
}

/** PeerJoinedMessage will send if a peer has joined */
export interface PeerJoinedMessage {
  peer: Peer | undefined;
}

/** PeerDisconnectedMessage will send if a peer has left */
export interface PeerDisconnectedMessage {
  peerID: number;
}

/** OfferMessage is sent offer SDP from offering peer to answer peer */
export interface OfferMessage {
  offerPeerID: number;
  offerSDP: string;
}

/** AnswerMessage is sent answer SDP from answer peer to offering peer */
export interface AnswerMessage {
  answerPeerID: number;
  answerSDP: string;
}

/** ICECandidateMessage is not using yet */
export interface ICECandidateMessage {
  peerID: number;
  candidate: string;
}

/** ServerMessage is the message sent from server */
export interface ServerMessage {
  hubInfoMessage?: HubInfoMessage | undefined;
  peerJoined?: PeerJoinedMessage | undefined;
  peerDisconnected?: PeerDisconnectedMessage | undefined;
  offerMessage?: OfferMessage | undefined;
  answerMessage?: AnswerMessage | undefined;
  iceCandidateMessage?: ICECandidateMessage | undefined;
}

function createBasePeer(): Peer {
  return { id: 0, metaData: "", joinedAt: 0 };
}

export const Peer = {
  encode(message: Peer, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.id !== 0) {
      writer.uint32(8).uint32(message.id);
    }
    if (message.metaData !== "") {
      writer.uint32(18).string(message.metaData);
    }
    if (message.joinedAt !== 0) {
      writer.uint32(24).uint32(message.joinedAt);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): Peer {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBasePeer();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 8) {
            break;
          }

          message.id = reader.uint32();
          continue;
        case 2:
          if (tag !== 18) {
            break;
          }

          message.metaData = reader.string();
          continue;
        case 3:
          if (tag !== 24) {
            break;
          }

          message.joinedAt = reader.uint32();
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  fromJSON(object: any): Peer {
    return {
      id: isSet(object.id) ? globalThis.Number(object.id) : 0,
      metaData: isSet(object.metaData) ? globalThis.String(object.metaData) : "",
      joinedAt: isSet(object.joinedAt) ? globalThis.Number(object.joinedAt) : 0,
    };
  },

  toJSON(message: Peer): unknown {
    const obj: any = {};
    if (message.id !== 0) {
      obj.id = Math.round(message.id);
    }
    if (message.metaData !== "") {
      obj.metaData = message.metaData;
    }
    if (message.joinedAt !== 0) {
      obj.joinedAt = Math.round(message.joinedAt);
    }
    return obj;
  },

  create<I extends Exact<DeepPartial<Peer>, I>>(base?: I): Peer {
    return Peer.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<Peer>, I>>(object: I): Peer {
    const message = createBasePeer();
    message.id = object.id ?? 0;
    message.metaData = object.metaData ?? "";
    message.joinedAt = object.joinedAt ?? 0;
    return message;
  },
};

function createBaseHubInfoMessage(): HubInfoMessage {
  return { id: "", createdAt: 0, myPeerID: 0, peers: [] };
}

export const HubInfoMessage = {
  encode(message: HubInfoMessage, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.id !== "") {
      writer.uint32(10).string(message.id);
    }
    if (message.createdAt !== 0) {
      writer.uint32(16).uint32(message.createdAt);
    }
    if (message.myPeerID !== 0) {
      writer.uint32(24).uint32(message.myPeerID);
    }
    for (const v of message.peers) {
      Peer.encode(v!, writer.uint32(34).fork()).ldelim();
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): HubInfoMessage {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseHubInfoMessage();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break;
          }

          message.id = reader.string();
          continue;
        case 2:
          if (tag !== 16) {
            break;
          }

          message.createdAt = reader.uint32();
          continue;
        case 3:
          if (tag !== 24) {
            break;
          }

          message.myPeerID = reader.uint32();
          continue;
        case 4:
          if (tag !== 34) {
            break;
          }

          message.peers.push(Peer.decode(reader, reader.uint32()));
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  fromJSON(object: any): HubInfoMessage {
    return {
      id: isSet(object.id) ? globalThis.String(object.id) : "",
      createdAt: isSet(object.createdAt) ? globalThis.Number(object.createdAt) : 0,
      myPeerID: isSet(object.myPeerID) ? globalThis.Number(object.myPeerID) : 0,
      peers: globalThis.Array.isArray(object?.peers) ? object.peers.map((e: any) => Peer.fromJSON(e)) : [],
    };
  },

  toJSON(message: HubInfoMessage): unknown {
    const obj: any = {};
    if (message.id !== "") {
      obj.id = message.id;
    }
    if (message.createdAt !== 0) {
      obj.createdAt = Math.round(message.createdAt);
    }
    if (message.myPeerID !== 0) {
      obj.myPeerID = Math.round(message.myPeerID);
    }
    if (message.peers?.length) {
      obj.peers = message.peers.map((e) => Peer.toJSON(e));
    }
    return obj;
  },

  create<I extends Exact<DeepPartial<HubInfoMessage>, I>>(base?: I): HubInfoMessage {
    return HubInfoMessage.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<HubInfoMessage>, I>>(object: I): HubInfoMessage {
    const message = createBaseHubInfoMessage();
    message.id = object.id ?? "";
    message.createdAt = object.createdAt ?? 0;
    message.myPeerID = object.myPeerID ?? 0;
    message.peers = object.peers?.map((e) => Peer.fromPartial(e)) || [];
    return message;
  },
};

function createBasePeerJoinedMessage(): PeerJoinedMessage {
  return { peer: undefined };
}

export const PeerJoinedMessage = {
  encode(message: PeerJoinedMessage, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.peer !== undefined) {
      Peer.encode(message.peer, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): PeerJoinedMessage {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBasePeerJoinedMessage();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break;
          }

          message.peer = Peer.decode(reader, reader.uint32());
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  fromJSON(object: any): PeerJoinedMessage {
    return { peer: isSet(object.peer) ? Peer.fromJSON(object.peer) : undefined };
  },

  toJSON(message: PeerJoinedMessage): unknown {
    const obj: any = {};
    if (message.peer !== undefined) {
      obj.peer = Peer.toJSON(message.peer);
    }
    return obj;
  },

  create<I extends Exact<DeepPartial<PeerJoinedMessage>, I>>(base?: I): PeerJoinedMessage {
    return PeerJoinedMessage.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<PeerJoinedMessage>, I>>(object: I): PeerJoinedMessage {
    const message = createBasePeerJoinedMessage();
    message.peer = (object.peer !== undefined && object.peer !== null) ? Peer.fromPartial(object.peer) : undefined;
    return message;
  },
};

function createBasePeerDisconnectedMessage(): PeerDisconnectedMessage {
  return { peerID: 0 };
}

export const PeerDisconnectedMessage = {
  encode(message: PeerDisconnectedMessage, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.peerID !== 0) {
      writer.uint32(8).uint32(message.peerID);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): PeerDisconnectedMessage {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBasePeerDisconnectedMessage();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 8) {
            break;
          }

          message.peerID = reader.uint32();
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  fromJSON(object: any): PeerDisconnectedMessage {
    return { peerID: isSet(object.peerID) ? globalThis.Number(object.peerID) : 0 };
  },

  toJSON(message: PeerDisconnectedMessage): unknown {
    const obj: any = {};
    if (message.peerID !== 0) {
      obj.peerID = Math.round(message.peerID);
    }
    return obj;
  },

  create<I extends Exact<DeepPartial<PeerDisconnectedMessage>, I>>(base?: I): PeerDisconnectedMessage {
    return PeerDisconnectedMessage.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<PeerDisconnectedMessage>, I>>(object: I): PeerDisconnectedMessage {
    const message = createBasePeerDisconnectedMessage();
    message.peerID = object.peerID ?? 0;
    return message;
  },
};

function createBaseOfferMessage(): OfferMessage {
  return { offerPeerID: 0, offerSDP: "" };
}

export const OfferMessage = {
  encode(message: OfferMessage, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.offerPeerID !== 0) {
      writer.uint32(8).uint32(message.offerPeerID);
    }
    if (message.offerSDP !== "") {
      writer.uint32(18).string(message.offerSDP);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): OfferMessage {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseOfferMessage();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 8) {
            break;
          }

          message.offerPeerID = reader.uint32();
          continue;
        case 2:
          if (tag !== 18) {
            break;
          }

          message.offerSDP = reader.string();
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  fromJSON(object: any): OfferMessage {
    return {
      offerPeerID: isSet(object.offerPeerID) ? globalThis.Number(object.offerPeerID) : 0,
      offerSDP: isSet(object.offerSDP) ? globalThis.String(object.offerSDP) : "",
    };
  },

  toJSON(message: OfferMessage): unknown {
    const obj: any = {};
    if (message.offerPeerID !== 0) {
      obj.offerPeerID = Math.round(message.offerPeerID);
    }
    if (message.offerSDP !== "") {
      obj.offerSDP = message.offerSDP;
    }
    return obj;
  },

  create<I extends Exact<DeepPartial<OfferMessage>, I>>(base?: I): OfferMessage {
    return OfferMessage.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<OfferMessage>, I>>(object: I): OfferMessage {
    const message = createBaseOfferMessage();
    message.offerPeerID = object.offerPeerID ?? 0;
    message.offerSDP = object.offerSDP ?? "";
    return message;
  },
};

function createBaseAnswerMessage(): AnswerMessage {
  return { answerPeerID: 0, answerSDP: "" };
}

export const AnswerMessage = {
  encode(message: AnswerMessage, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.answerPeerID !== 0) {
      writer.uint32(8).uint32(message.answerPeerID);
    }
    if (message.answerSDP !== "") {
      writer.uint32(18).string(message.answerSDP);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): AnswerMessage {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseAnswerMessage();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 8) {
            break;
          }

          message.answerPeerID = reader.uint32();
          continue;
        case 2:
          if (tag !== 18) {
            break;
          }

          message.answerSDP = reader.string();
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  fromJSON(object: any): AnswerMessage {
    return {
      answerPeerID: isSet(object.answerPeerID) ? globalThis.Number(object.answerPeerID) : 0,
      answerSDP: isSet(object.answerSDP) ? globalThis.String(object.answerSDP) : "",
    };
  },

  toJSON(message: AnswerMessage): unknown {
    const obj: any = {};
    if (message.answerPeerID !== 0) {
      obj.answerPeerID = Math.round(message.answerPeerID);
    }
    if (message.answerSDP !== "") {
      obj.answerSDP = message.answerSDP;
    }
    return obj;
  },

  create<I extends Exact<DeepPartial<AnswerMessage>, I>>(base?: I): AnswerMessage {
    return AnswerMessage.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<AnswerMessage>, I>>(object: I): AnswerMessage {
    const message = createBaseAnswerMessage();
    message.answerPeerID = object.answerPeerID ?? 0;
    message.answerSDP = object.answerSDP ?? "";
    return message;
  },
};

function createBaseICECandidateMessage(): ICECandidateMessage {
  return { peerID: 0, candidate: "" };
}

export const ICECandidateMessage = {
  encode(message: ICECandidateMessage, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.peerID !== 0) {
      writer.uint32(8).uint32(message.peerID);
    }
    if (message.candidate !== "") {
      writer.uint32(18).string(message.candidate);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): ICECandidateMessage {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseICECandidateMessage();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 8) {
            break;
          }

          message.peerID = reader.uint32();
          continue;
        case 2:
          if (tag !== 18) {
            break;
          }

          message.candidate = reader.string();
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  fromJSON(object: any): ICECandidateMessage {
    return {
      peerID: isSet(object.peerID) ? globalThis.Number(object.peerID) : 0,
      candidate: isSet(object.candidate) ? globalThis.String(object.candidate) : "",
    };
  },

  toJSON(message: ICECandidateMessage): unknown {
    const obj: any = {};
    if (message.peerID !== 0) {
      obj.peerID = Math.round(message.peerID);
    }
    if (message.candidate !== "") {
      obj.candidate = message.candidate;
    }
    return obj;
  },

  create<I extends Exact<DeepPartial<ICECandidateMessage>, I>>(base?: I): ICECandidateMessage {
    return ICECandidateMessage.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<ICECandidateMessage>, I>>(object: I): ICECandidateMessage {
    const message = createBaseICECandidateMessage();
    message.peerID = object.peerID ?? 0;
    message.candidate = object.candidate ?? "";
    return message;
  },
};

function createBaseServerMessage(): ServerMessage {
  return {
    hubInfoMessage: undefined,
    peerJoined: undefined,
    peerDisconnected: undefined,
    offerMessage: undefined,
    answerMessage: undefined,
    iceCandidateMessage: undefined,
  };
}

export const ServerMessage = {
  encode(message: ServerMessage, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.hubInfoMessage !== undefined) {
      HubInfoMessage.encode(message.hubInfoMessage, writer.uint32(10).fork()).ldelim();
    }
    if (message.peerJoined !== undefined) {
      PeerJoinedMessage.encode(message.peerJoined, writer.uint32(18).fork()).ldelim();
    }
    if (message.peerDisconnected !== undefined) {
      PeerDisconnectedMessage.encode(message.peerDisconnected, writer.uint32(26).fork()).ldelim();
    }
    if (message.offerMessage !== undefined) {
      OfferMessage.encode(message.offerMessage, writer.uint32(34).fork()).ldelim();
    }
    if (message.answerMessage !== undefined) {
      AnswerMessage.encode(message.answerMessage, writer.uint32(42).fork()).ldelim();
    }
    if (message.iceCandidateMessage !== undefined) {
      ICECandidateMessage.encode(message.iceCandidateMessage, writer.uint32(50).fork()).ldelim();
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): ServerMessage {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseServerMessage();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break;
          }

          message.hubInfoMessage = HubInfoMessage.decode(reader, reader.uint32());
          continue;
        case 2:
          if (tag !== 18) {
            break;
          }

          message.peerJoined = PeerJoinedMessage.decode(reader, reader.uint32());
          continue;
        case 3:
          if (tag !== 26) {
            break;
          }

          message.peerDisconnected = PeerDisconnectedMessage.decode(reader, reader.uint32());
          continue;
        case 4:
          if (tag !== 34) {
            break;
          }

          message.offerMessage = OfferMessage.decode(reader, reader.uint32());
          continue;
        case 5:
          if (tag !== 42) {
            break;
          }

          message.answerMessage = AnswerMessage.decode(reader, reader.uint32());
          continue;
        case 6:
          if (tag !== 50) {
            break;
          }

          message.iceCandidateMessage = ICECandidateMessage.decode(reader, reader.uint32());
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  fromJSON(object: any): ServerMessage {
    return {
      hubInfoMessage: isSet(object.hubInfoMessage) ? HubInfoMessage.fromJSON(object.hubInfoMessage) : undefined,
      peerJoined: isSet(object.peerJoined) ? PeerJoinedMessage.fromJSON(object.peerJoined) : undefined,
      peerDisconnected: isSet(object.peerDisconnected)
        ? PeerDisconnectedMessage.fromJSON(object.peerDisconnected)
        : undefined,
      offerMessage: isSet(object.offerMessage) ? OfferMessage.fromJSON(object.offerMessage) : undefined,
      answerMessage: isSet(object.answerMessage) ? AnswerMessage.fromJSON(object.answerMessage) : undefined,
      iceCandidateMessage: isSet(object.iceCandidateMessage)
        ? ICECandidateMessage.fromJSON(object.iceCandidateMessage)
        : undefined,
    };
  },

  toJSON(message: ServerMessage): unknown {
    const obj: any = {};
    if (message.hubInfoMessage !== undefined) {
      obj.hubInfoMessage = HubInfoMessage.toJSON(message.hubInfoMessage);
    }
    if (message.peerJoined !== undefined) {
      obj.peerJoined = PeerJoinedMessage.toJSON(message.peerJoined);
    }
    if (message.peerDisconnected !== undefined) {
      obj.peerDisconnected = PeerDisconnectedMessage.toJSON(message.peerDisconnected);
    }
    if (message.offerMessage !== undefined) {
      obj.offerMessage = OfferMessage.toJSON(message.offerMessage);
    }
    if (message.answerMessage !== undefined) {
      obj.answerMessage = AnswerMessage.toJSON(message.answerMessage);
    }
    if (message.iceCandidateMessage !== undefined) {
      obj.iceCandidateMessage = ICECandidateMessage.toJSON(message.iceCandidateMessage);
    }
    return obj;
  },

  create<I extends Exact<DeepPartial<ServerMessage>, I>>(base?: I): ServerMessage {
    return ServerMessage.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<ServerMessage>, I>>(object: I): ServerMessage {
    const message = createBaseServerMessage();
    message.hubInfoMessage = (object.hubInfoMessage !== undefined && object.hubInfoMessage !== null)
      ? HubInfoMessage.fromPartial(object.hubInfoMessage)
      : undefined;
    message.peerJoined = (object.peerJoined !== undefined && object.peerJoined !== null)
      ? PeerJoinedMessage.fromPartial(object.peerJoined)
      : undefined;
    message.peerDisconnected = (object.peerDisconnected !== undefined && object.peerDisconnected !== null)
      ? PeerDisconnectedMessage.fromPartial(object.peerDisconnected)
      : undefined;
    message.offerMessage = (object.offerMessage !== undefined && object.offerMessage !== null)
      ? OfferMessage.fromPartial(object.offerMessage)
      : undefined;
    message.answerMessage = (object.answerMessage !== undefined && object.answerMessage !== null)
      ? AnswerMessage.fromPartial(object.answerMessage)
      : undefined;
    message.iceCandidateMessage = (object.iceCandidateMessage !== undefined && object.iceCandidateMessage !== null)
      ? ICECandidateMessage.fromPartial(object.iceCandidateMessage)
      : undefined;
    return message;
  },
};

type Builtin = Date | Function | Uint8Array | string | number | boolean | undefined;

export type DeepPartial<T> = T extends Builtin ? T
  : T extends globalThis.Array<infer U> ? globalThis.Array<DeepPartial<U>>
  : T extends ReadonlyArray<infer U> ? ReadonlyArray<DeepPartial<U>>
  : T extends {} ? { [K in keyof T]?: DeepPartial<T[K]> }
  : Partial<T>;

type KeysOfUnion<T> = T extends T ? keyof T : never;
export type Exact<P, I extends P> = P extends Builtin ? P
  : P & { [K in keyof P]: Exact<P[K], I[K]> } & { [K in Exclude<keyof I, KeysOfUnion<P>>]: never };

function isSet(value: any): boolean {
  return value !== null && value !== undefined;
}
