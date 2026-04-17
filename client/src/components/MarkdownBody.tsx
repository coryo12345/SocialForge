import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

interface Props {
  children: string;
  className?: string;
}

export default function MarkdownBody({ children, className = '' }: Props) {
  return (
    <div className={`prose prose-sm dark:prose-invert max-w-none ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          img: () => null,
          a: ({ href, children: c }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">{c}</a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
