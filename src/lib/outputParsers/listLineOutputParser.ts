import { BaseOutputParser } from '@langchain/core/output_parsers';

interface LineListOutputParserArgs {
  key?: string;
}

const LIST_PREFIX_REGEX = /^(\s*(-|\*|\d+\.\s|\d+\)\s|\u2022)\s*)+/;

class LineListOutputParser extends BaseOutputParser<string[]> {
  private key = 'questions';

  constructor(args?: LineListOutputParserArgs) {
    super();
    this.key = args?.key ?? this.key;
  }

  static lc_name() {
    return 'LineListOutputParser';
  }

  lc_namespace = ['langchain', 'output_parsers', 'line_list_output_parser'];

  private extractTaggedBlock(text: string) {
    const fullTagPattern = new RegExp(`<${this.key}>([\\s\\S]*?)<\\/${this.key}>`, 'i');
    const openOnlyPattern = new RegExp(`<${this.key}>([\\s\\S]*)`, 'i');

    const fullTag = text.match(fullTagPattern);
    if (fullTag?.[1]) {
      return fullTag[1];
    }

    const openOnlyTag = text.match(openOnlyPattern);
    if (openOnlyTag?.[1]) {
      return openOnlyTag[1];
    }

    return null;
  }

  private normalizeLines(raw: string) {
    return raw
      .replace(/```[a-zA-Z]*\n?/g, '')
      .replace(/```/g, '')
      .split('\n')
      .map((line) =>
        line
          .replace(LIST_PREFIX_REGEX, '')
          .replace(/<[^>]+>/g, '')
          .trim(),
      )
      .filter((line) => line.length > 0);
  }

  async parse(text: string): Promise<string[]> {
    text = text.trim() || '';
    if (!text) return [];

    const taggedBlock = this.extractTaggedBlock(text);
    if (taggedBlock) {
      return this.normalizeLines(taggedBlock);
    }

    // Fallback for model outputs that skip XML tags.
    if (this.key === 'links') {
      const links = Array.from(
        new Set(text.match(/https?:\/\/[^\s<>")]+/gi) ?? []),
      ).map((link) => link.trim());

      return links;
    }

    const lines = this.normalizeLines(text);

    // For generic list keys (like suggestions), avoid returning a single giant paragraph.
    if (lines.length <= 1) {
      return [];
    }

    return lines;
  }

  getFormatInstructions(): string {
    throw new Error('Not implemented.');
  }
}

export default LineListOutputParser;
