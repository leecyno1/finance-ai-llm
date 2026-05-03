import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { DocxLoader } from '@langchain/community/document_loaders/fs/docx';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { Document } from '@langchain/core/documents';
import ModelRegistry from '@/lib/models/registry';

interface FileRes {
  fileName: string;
  fileExtension: string;
  fileId: string;
}

const uploadDir = path.join(process.cwd(), 'uploads');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 500,
  chunkOverlap: 100,
});

export async function POST(req: Request) {
  try {
    const formData = await req.formData();

    const files = formData.getAll('files') as File[];
    const embedding_model = formData.get('embedding_model_key') as string;
    const embedding_model_provider = formData.get('embedding_model_provider_id') as string;

    if (!embedding_model || !embedding_model_provider) {
      return NextResponse.json(
        { message: 'Missing embedding model or provider' },
        { status: 400 },
      );
    }

    const registry = new ModelRegistry();

    const model = await registry.loadEmbeddingModel(embedding_model_provider, embedding_model);

    const processedFiles: FileRes[] = [];

    for (const file of files) {
      const fileExtension = file.name.split('.').pop()?.toLowerCase();
      if (!fileExtension || !['pdf', 'docx', 'txt'].includes(fileExtension)) {
        return NextResponse.json(
          { message: 'File type not supported' },
          { status: 400 },
        );
      }
    }

    await Promise.all(
      files.map(async (file: any) => {
        const fileExtension = file.name.split('.').pop()?.toLowerCase()!;

        const uniqueFileName = `${crypto.randomBytes(16).toString('hex')}.${fileExtension}`;
        const filePath = path.join(uploadDir, uniqueFileName);

        const buffer = Buffer.from(await file.arrayBuffer());
        fs.writeFileSync(filePath, new Uint8Array(buffer));

        let docs: any[] = [];
        if (fileExtension === 'pdf') {
          const loader = new PDFLoader(filePath);
          docs = await loader.load();
        } else if (fileExtension === 'docx') {
          const loader = new DocxLoader(filePath);
          docs = await loader.load();
        } else if (fileExtension === 'txt') {
          const text = fs.readFileSync(filePath, 'utf-8');
          docs = [
            new Document({ pageContent: text, metadata: { title: file.name } }),
          ];
        }

        const splitted = await splitter.splitDocuments(docs);

        const extractedDataPath = filePath.replace(/\.\w+$/, '-extracted.json');
        fs.writeFileSync(
          extractedDataPath,
          JSON.stringify({
            title: file.name,
            contents: splitted.map((doc) => doc.pageContent),
          }),
        );

        const embeddings = await model.embedDocuments(
          splitted.map((doc) => doc.pageContent),
        );
        const embeddingsDataPath = filePath.replace(
          /\.\w+$/,
          '-embeddings.json',
        );
        fs.writeFileSync(
          embeddingsDataPath,
          JSON.stringify({
            title: file.name,
            embeddings,
          }),
        );

        processedFiles.push({
          fileName: file.name,
          fileExtension: fileExtension,
          fileId: uniqueFileName.replace(/\.\w+$/, ''),
        });
      }),
    );

    return NextResponse.json({
      files: processedFiles,
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    const errorText = `${(error as any)?.message || ''} ${(error as any)?.cause?.message || ''}`;
    const message =
      /huggingface\.co|ECONNRESET|fetch failed/i.test(errorText)
        ? '上传失败：当前服务无法连接嵌入模型源（huggingface.co），请切换可用 Embedding 模型或检查网络。'
        : /minimax embedding request failed|minimax embedding response missing vectors|vectors mismatch|login fail|authorization/i.test(
              errorText,
            )
          ? /insufficient balance/i.test(errorText)
            ? '上传失败：MiniMax Embedding 余额不足，请在 MiniMax 平台充值后重试。'
            : '上传失败：MiniMax Embedding 调用异常，请检查 MINIMAX_API_KEY、MINIMAX_BASE_URL 与 MINIMAX_EMBEDDING_MODEL。'
          : 'An error has occurred.';

    return NextResponse.json(
      { message },
      { status: 500 },
    );
  }
}
