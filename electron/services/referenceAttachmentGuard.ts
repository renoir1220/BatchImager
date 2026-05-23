export interface ReferenceAttachmentMessage {
  content: string;
  role?: string;
}

export const MISSING_REFERENCE_IMAGE_REPLY = "我没有收到可用的参考图附件，请先粘贴或添加参考图后再发送。";
const MISSING_REFERENCE_IMAGE_PATTERN =
  /(?:附件|附图|参考图|刚才.*图|之前.*图|上次.*图|第一个\s*prompt.*图|第一条\s*prompt.*图)/i;

export function shouldReportMissingReferenceImage(options: {
  messages: ReferenceAttachmentMessage[];
  referenceImageCount: number;
}): boolean {
  if (options.referenceImageCount > 0) {
    return false;
  }

  return MISSING_REFERENCE_IMAGE_PATTERN.test(getLatestUserMessage(options.messages));
}

export function getMissingReferenceImageReply(): string {
  return MISSING_REFERENCE_IMAGE_REPLY;
}

function getLatestUserMessage(messages: ReferenceAttachmentMessage[]): string {
  return (
    [...messages]
      .reverse()
      .find((message) => message.role === undefined || message.role === "user")
      ?.content.trim() ?? ""
  );
}
