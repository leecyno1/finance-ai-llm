import axios from 'axios';
import { htmlToText } from 'html-to-text';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { Document } from '@langchain/core/documents';
import pdfParse from 'pdf-parse';

const DEFAULT_HEADERS = {
  // Many Chinese news sites block unknown crawlers; a browser-like UA helps.
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

const cleanExtractedText = (raw: string) => {
  if (!raw) return '';

  const dropLine =
    /(浙ICP备|版权所有|不良信息举报|证券投资咨询|风险提示|本文内容仅供参考|不代表.*观点|投资者据此操作|不承担任何责任|法律声明|友情链接|招聘英才|联系我们|关于.*公司|软件下载|返回首页|下载客户端|登录|注册)/i;

  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !dropLine.test(l))
    .filter((l) => !/^(首页|行情|商城|更多工具|特色工具)$/i.test(l));

  let text = lines.join('\n');

  // Drop asset URLs and icon placeholders that pollute HTML-to-text output.
  text = text.replace(/\[[^\]]*(?:https?:\/\/|\/\/)[^\]]+\]/gi, '');
  text = text.replace(/\/\/\S+\.(?:png|jpe?g|gif|svg|webp|css|js)(\?\S*)?/gi, '');
  text = text.replace(/\b(separator|arrowRight|homeBack)\b/gi, '');

  text = text.replace(/[ \t]{2,}/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
};

export const getDocumentsFromLinks = async ({ links }: { links: string[] }) => {
  const splitter = new RecursiveCharacterTextSplitter();

  let docs: Document[] = [];

  await Promise.all(
    links.map(async (link) => {
      link =
        link.startsWith('http://') || link.startsWith('https://')
          ? link
          : `https://${link}`;

      try {
        const res = await axios.get(link, {
          responseType: 'arraybuffer',
          timeout: 15000,
          headers: DEFAULT_HEADERS,
        });

        const isPdf = res.headers['content-type'] === 'application/pdf';

        if (isPdf) {
          const pdfText = await pdfParse(res.data);
          const parsedText = pdfText.text
            .replace(/(\r\n|\n|\r)/gm, ' ')
            .replace(/\s+/g, ' ')
            .trim();

          const splittedText = await splitter.splitText(parsedText);
          const title = 'PDF Document';

          const linkDocs = splittedText.map((text) => {
            return new Document({
              pageContent: text,
              metadata: {
                title: title,
                url: link,
              },
            });
          });

          docs.push(...linkDocs);
          return;
        }

        const rawText = htmlToText(res.data.toString('utf8'), {
          wordwrap: false,
          selectors: [
            {
              selector: 'a',
              options: {
                ignoreHref: true,
              },
            },
            { selector: 'img', format: 'skip' },
            { selector: 'svg', format: 'skip' },
            { selector: 'script', format: 'skip' },
            { selector: 'style', format: 'skip' },
            { selector: 'noscript', format: 'skip' },
            { selector: 'nav', format: 'skip' },
            { selector: 'header', format: 'skip' },
            { selector: 'footer', format: 'skip' },
          ],
        })
          .trim();

        // Prefer line-based cleanup before collapsing whitespace.
        let parsedText = cleanExtractedText(rawText);
        if (!parsedText) {
          parsedText = rawText;
        }

        parsedText = parsedText
          .replace(/(\r\n|\n|\r)/gm, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        const splittedText = await splitter.splitText(parsedText);
        const title = res.data
          .toString('utf8')
          .match(/<title.*>(.*?)<\/title>/)?.[1];

        const linkDocs = splittedText.map((text) => {
          return new Document({
            pageContent: text,
            metadata: {
              title: title || link,
              url: link,
            },
          });
        });

        docs.push(...linkDocs);
      } catch (err) {
        console.error(
          'An error occurred while getting documents from links: ',
          err,
        );
        docs.push(
          new Document({
            pageContent: `Failed to retrieve content from the link: ${err}`,
            metadata: {
              title: 'Failed to retrieve content',
              url: link,
            },
          }),
        );
      }
    }),
  );

  return docs;
};
