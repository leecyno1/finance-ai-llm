const MessageBoxLoading = ({ status }: { status?: string }) => {
  return (
    <div className="flex flex-col space-y-3 w-full lg:w-9/12 bg-light-primary dark:bg-dark-primary rounded-lg py-3">
      <div className="flex items-center gap-2 text-sm text-black/70 dark:text-white/70">
        <span className="inline-block h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
        <span>{status || '正在处理中...'}</span>
      </div>
      <div className="h-2 rounded-full w-full bg-light-secondary dark:bg-dark-secondary animate-pulse" />
      <div className="h-2 rounded-full w-9/12 bg-light-secondary dark:bg-dark-secondary animate-pulse" />
      <div className="h-2 rounded-full w-10/12 bg-light-secondary dark:bg-dark-secondary animate-pulse" />
    </div>
  );
};

export default MessageBoxLoading;
