import { BaseOutputParser } from '@langchain/core/output_parsers';

interface LineOutputParserArgs {
  key?: string;
}

const LIST_PREFIX_REGEX = /^(\s*(-|\*|\d+\.\s|\d+\)\s|\u2022)\s*)+/;

class LineOutputParser extends BaseOutputParser<string | undefined> {
  private key = 'questions';

  constructor(args?: LineOutputParserArgs) {
    super();
    this.key = args?.key ?? this.key;
  }

  static lc_name() {
    return 'LineOutputParser';
  }

  lc_namespace = ['langchain', 'output_parsers', 'line_output_parser'];

  private extractTaggedValue(text: string) {
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

  private normalize(raw: string) {
    return raw
      .replace(/```[a-zA-Z]*\n?/g, '')
      .replace(/```/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(LIST_PREFIX_REGEX, '')
      .trim();
  }

  async parse(text: string): Promise<string | undefined> {
    text = text.trim() || '';
    if (!text) return undefined;

    const taggedValue = this.extractTaggedValue(text);
    if (taggedValue) {
      const line = this.normalize(taggedValue);
      return line || undefined;
    }

    // Fallback for model outputs that skip expected tags.
    const firstLine = text.split('\n').map((line) => this.normalize(line))[0] ?? '';
    return firstLine || undefined;
  }

  getFormatInstructions(): string {
    throw new Error('Not implemented.');
  }
}

export default LineOutputParser;
