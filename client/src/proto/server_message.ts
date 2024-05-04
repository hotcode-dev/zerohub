/* eslint-disable */
import * as _m0 from "protobufjs/minimal";

export const protobufPackage = "";

/** Peer includes peer infomation and peer metadata */
export interface Peer {
  id: number;
  metadata: string;
  joinedAt: number;
}

/** HubInfoMessage includes hub infomation */
export interface HubInfoMessage {
  id: string;
  createdAt: number;
  myPeerId: number;
  hubMetadata: string;
  peers: Peer[];
}

/** PeerJoinedMessage will send if a peer has joined */
export interface PeerJoinedMessage {
  peer: Peer | undefined;
}

/** PeerDisconnectedMessage will send if a peer has left */
export interface PeerDisconnectedMessage {
  peerId: number;
}

/** OfferMessage is sent offer SDP from offering peer to answer peer */
export interface OfferMessage {
  offerPeerId: number;
  offerSdp: string;
}

/** AnswerMessage is sent answer SDP from answer peer to offering peer */
export interface AnswerMessage {
  answerPeerId: number;
  answerSdp: string;
}

/** IceCandidateMessage is not using yet */
export interface IceCandidateMessage {
  peerId: number;
  candidate: string;
}

/** ServerMessage is the message sent from server */
export interface ServerMessage {
  hubInfoMessage?: HubInfoMessage | undefined;
  peerJoinedMessage?: PeerJoinedMessage | undefined;
  peerDisconnectedMessage?: PeerDisconnectedMessage | undefined;
  offerMessage?: OfferMessage | undefined;
  answerMessage?: AnswerMessage | undefined;
  iceCandidateMessage?: IceCandidateMessage | undefined;
}

function createBasePeer(): Peer {
  return { id: 0, metadata: "", joinedAt: 0 };
}

export const Peer = {
  encode(message: Peer, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.id !== 0) {
      writer.uint32(8).uint32(message.id);
    }
    if (message.metadata !== "") {
      writer.uint32(18).string(message.metadata);
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

          message.metadata = reader.string();
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
      metadata: isSet(object.metadata) ? globalThis.String(object.metadata) : "",
      joinedAt: isSet(object.joinedAt) ? globalThis.Number(object.joinedAt) : 0,
    };
  },

  toJSON(message: Peer): unknown {
    const obj: any = {};
    if (message.id !== 0) {
      obj.id = Math.round(message.id);
    }
    if (message.metadata !== "") {
      obj.metadata = message.metadata;
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
    message.metadata = object.metadata ?? "";
    message.joinedAt = object.joinedAt ?? 0;
    return message;
  },
};

function createBaseHubInfoMessage(): HubInfoMessage {
  return { id: "", createdAt: 0, myPeerId: 0, hubMetadata: "", peers: [] };
}

export const HubInfoMessage = {
  encode(message: HubInfoMessage, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.id !== "") {
      writer.uint32(10).string(message.id);
    }
    if (message.createdAt !== 0) {
      writer.uint32(16).uint32(message.createdAt);
    }
    if (message.myPeerId !== 0) {
      writer.uint32(24).uint32(message.myPeerId);
    }
    if (message.hubMetadata !== "") {
      writer.uint32(34).string(message.hubMetadata);
    }
    for (const v of message.peers) {
      Peer.encode(v!, writer.uint32(42).fork()).ldelim();
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

          message.myPeerId = reader.uint32();
          continue;
        case 4:
          if (tag !== 34) {
            break;
          }

          message.hubMetadata = reader.string();
          continue;
        case 5:
          if (tag !== 42) {
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
      myPeerId: isSet(object.myPeerId) ? globalThis.Number(object.myPeerId) : 0,
      hubMetadata: isSet(object.hubMetadata) ? globalThis.String(object.hubMetadata) : "",
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
    if (message.myPeerId !== 0) {
      obj.myPeerId = Math.round(message.myPeerId);
    }
    if (message.hubMetadata !== "") {
      obj.hubMetadata = message.hubMetadata;
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
    message.myPeerId = object.myPeerId ?? 0;
    message.hubMetadata = object.hubMetadata ?? "";
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
  return { peerId: 0 };
}

export const PeerDisconnectedMessage = {
  encode(message: PeerDisconnectedMessage, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.peerId !== 0) {
      writer.uint32(8).uint32(message.peerId);
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

          message.peerId = reader.uint32();
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
    return { peerId: isSet(object.peerId) ? globalThis.Number(object.peerId) : 0 };
  },

  toJSON(message: PeerDisconnectedMessage): unknown {
    const obj: any = {};
    if (message.peerId !== 0) {
      obj.peerId = Math.round(message.peerId);
    }
    return obj;
  },

  create<I extends Exact<DeepPartial<PeerDisconnectedMessage>, I>>(base?: I): PeerDisconnectedMessage {
    return PeerDisconnectedMessage.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<PeerDisconnectedMessage>, I>>(object: I): PeerDisconnectedMessage {
    const message = createBasePeerDisconnectedMessage();
    message.peerId = object.peerId ?? 0;
    return message;
  },
};

function createBaseOfferMessage(): OfferMessage {
  return { offerPeerId: 0, offerSdp: "" };
}

export const OfferMessage = {
  encode(message: OfferMessage, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.offerPeerId !== 0) {
      writer.uint32(8).uint32(message.offerPeerId);
    }
    if (message.offerSdp !== "") {
      writer.uint32(18).string(message.offerSdp);
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

          message.offerPeerId = reader.uint32();
          continue;
        case 2:
          if (tag !== 18) {
            break;
          }

          message.offerSdp = reader.string();
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
      offerPeerId: isSet(object.offerPeerId) ? globalThis.Number(object.offerPeerId) : 0,
      offerSdp: isSet(object.offerSdp) ? globalThis.String(object.offerSdp) : "",
    };
  },

  toJSON(message: OfferMessage): unknown {
    const obj: any = {};
    if (message.offerPeerId !== 0) {
      obj.offerPeerId = Math.round(message.offerPeerId);
    }
    if (message.offerSdp !== "") {
      obj.offerSdp = message.offerSdp;
    }
    return obj;
  },

  create<I extends Exact<DeepPartial<OfferMessage>, I>>(base?: I): OfferMessage {
    return OfferMessage.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<OfferMessage>, I>>(object: I): OfferMessage {
    const message = createBaseOfferMessage();
    message.offerPeerId = object.offerPeerId ?? 0;
    message.offerSdp = object.offerSdp ?? "";
    return message;
  },
};

function createBaseAnswerMessage(): AnswerMessage {
  return { answerPeerId: 0, answerSdp: "" };
}

export const AnswerMessage = {
  encode(message: AnswerMessage, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.answerPeerId !== 0) {
      writer.uint32(8).uint32(message.answerPeerId);
    }
    if (message.answerSdp !== "") {
      writer.uint32(18).string(message.answerSdp);
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

          message.answerPeerId = reader.uint32();
          continue;
        case 2:
          if (tag !== 18) {
            break;
          }

          message.answerSdp = reader.string();
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
      answerPeerId: isSet(object.answerPeerId) ? globalThis.Number(object.answerPeerId) : 0,
      answerSdp: isSet(object.answerSdp) ? globalThis.String(object.answerSdp) : "",
    };
  },

  toJSON(message: AnswerMessage): unknown {
    const obj: any = {};
    if (message.answerPeerId !== 0) {
      obj.answerPeerId = Math.round(message.answerPeerId);
    }
    if (message.answerSdp !== "") {
      obj.answerSdp = message.answerSdp;
    }
    return obj;
  },

  create<I extends Exact<DeepPartial<AnswerMessage>, I>>(base?: I): AnswerMessage {
    return AnswerMessage.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<AnswerMessage>, I>>(object: I): AnswerMessage {
    const message = createBaseAnswerMessage();
    message.answerPeerId = object.answerPeerId ?? 0;
    message.answerSdp = object.answerSdp ?? "";
    return message;
  },
};

function createBaseIceCandidateMessage(): IceCandidateMessage {
  return { peerId: 0, candidate: "" };
}

export const IceCandidateMessage = {
  encode(message: IceCandidateMessage, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.peerId !== 0) {
      writer.uint32(8).uint32(message.peerId);
    }
    if (message.candidate !== "") {
      writer.uint32(18).string(message.candidate);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): IceCandidateMessage {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseIceCandidateMessage();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 8) {
            break;
          }

          message.peerId = reader.uint32();
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

  fromJSON(object: any): IceCandidateMessage {
    return {
      peerId: isSet(object.peerId) ? globalThis.Number(object.peerId) : 0,
      candidate: isSet(object.candidate) ? globalThis.String(object.candidate) : "",
    };
  },

  toJSON(message: IceCandidateMessage): unknown {
    const obj: any = {};
    if (message.peerId !== 0) {
      obj.peerId = Math.round(message.peerId);
    }
    if (message.candidate !== "") {
      obj.candidate = message.candidate;
    }
    return obj;
  },

  create<I extends Exact<DeepPartial<IceCandidateMessage>, I>>(base?: I): IceCandidateMessage {
    return IceCandidateMessage.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<IceCandidateMessage>, I>>(object: I): IceCandidateMessage {
    const message = createBaseIceCandidateMessage();
    message.peerId = object.peerId ?? 0;
    message.candidate = object.candidate ?? "";
    return message;
  },
};

function createBaseServerMessage(): ServerMessage {
  return {
    hubInfoMessage: undefined,
    peerJoinedMessage: undefined,
    peerDisconnectedMessage: undefined,
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
    if (message.peerJoinedMessage !== undefined) {
      PeerJoinedMessage.encode(message.peerJoinedMessage, writer.uint32(18).fork()).ldelim();
    }
    if (message.peerDisconnectedMessage !== undefined) {
      PeerDisconnectedMessage.encode(message.peerDisconnectedMessage, writer.uint32(26).fork()).ldelim();
    }
    if (message.offerMessage !== undefined) {
      OfferMessage.encode(message.offerMessage, writer.uint32(34).fork()).ldelim();
    }
    if (message.answerMessage !== undefined) {
      AnswerMessage.encode(message.answerMessage, writer.uint32(42).fork()).ldelim();
    }
    if (message.iceCandidateMessage !== undefined) {
      IceCandidateMessage.encode(message.iceCandidateMessage, writer.uint32(50).fork()).ldelim();
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

          message.peerJoinedMessage = PeerJoinedMessage.decode(reader, reader.uint32());
          continue;
        case 3:
          if (tag !== 26) {
            break;
          }

          message.peerDisconnectedMessage = PeerDisconnectedMessage.decode(reader, reader.uint32());
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

          message.iceCandidateMessage = IceCandidateMessage.decode(reader, reader.uint32());
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
      peerJoinedMessage: isSet(object.peerJoinedMessage)
        ? PeerJoinedMessage.fromJSON(object.peerJoinedMessage)
        : undefined,
      peerDisconnectedMessage: isSet(object.peerDisconnectedMessage)
        ? PeerDisconnectedMessage.fromJSON(object.peerDisconnectedMessage)
        : undefined,
      offerMessage: isSet(object.offerMessage) ? OfferMessage.fromJSON(object.offerMessage) : undefined,
      answerMessage: isSet(object.answerMessage) ? AnswerMessage.fromJSON(object.answerMessage) : undefined,
      iceCandidateMessage: isSet(object.iceCandidateMessage)
        ? IceCandidateMessage.fromJSON(object.iceCandidateMessage)
        : undefined,
    };
  },

  toJSON(message: ServerMessage): unknown {
    const obj: any = {};
    if (message.hubInfoMessage !== undefined) {
      obj.hubInfoMessage = HubInfoMessage.toJSON(message.hubInfoMessage);
    }
    if (message.peerJoinedMessage !== undefined) {
      obj.peerJoinedMessage = PeerJoinedMessage.toJSON(message.peerJoinedMessage);
    }
    if (message.peerDisconnectedMessage !== undefined) {
      obj.peerDisconnectedMessage = PeerDisconnectedMessage.toJSON(message.peerDisconnectedMessage);
    }
    if (message.offerMessage !== undefined) {
      obj.offerMessage = OfferMessage.toJSON(message.offerMessage);
    }
    if (message.answerMessage !== undefined) {
      obj.answerMessage = AnswerMessage.toJSON(message.answerMessage);
    }
    if (message.iceCandidateMessage !== undefined) {
      obj.iceCandidateMessage = IceCandidateMessage.toJSON(message.iceCandidateMessage);
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
    message.peerJoinedMessage = (object.peerJoinedMessage !== undefined && object.peerJoinedMessage !== null)
      ? PeerJoinedMessage.fromPartial(object.peerJoinedMessage)
      : undefined;
    message.peerDisconnectedMessage =
      (object.peerDisconnectedMessage !== undefined && object.peerDisconnectedMessage !== null)
        ? PeerDisconnectedMessage.fromPartial(object.peerDisconnectedMessage)
        : undefined;
    message.offerMessage = (object.offerMessage !== undefined && object.offerMessage !== null)
      ? OfferMessage.fromPartial(object.offerMessage)
      : undefined;
    message.answerMessage = (object.answerMessage !== undefined && object.answerMessage !== null)
      ? AnswerMessage.fromPartial(object.answerMessage)
      : undefined;
    message.iceCandidateMessage = (object.iceCandidateMessage !== undefined && object.iceCandidateMessage !== null)
      ? IceCandidateMessage.fromPartial(object.iceCandidateMessage)
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
