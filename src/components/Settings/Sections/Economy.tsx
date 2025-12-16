import { UIConfigField } from '@/lib/config/types';
import SettingsField from '../SettingsField';
import { toast } from 'sonner';

const Economy = ({
  fields,
  values,
}: {
  fields: UIConfigField[];
  values: Record<string, any>;
}) => {
  const validateToken = async () => {
    try {
      const res = await fetch('/api/economy/tushare/validate', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
      });
      const json = (await res.json()) as any;
      if (json?.ok) {
        toast.success('TuShare token 校验通过');
        return;
      }

      const code = json?.code;
      const msg = json?.message || '校验失败';

      if (json?.reason === 'missing_token') {
        toast.error('未配置 TuShare token');
        return;
      }
      if (json?.reason === 'invalid_token') {
        toast.error(`TuShare token 无效（${code ?? ''}）${msg}`);
        return;
      }
      if (json?.reason === 'no_permission') {
        toast.error(`TuShare 无接口权限（${code ?? ''}）${msg}`);
        return;
      }

      toast.error(`TuShare 校验失败（${code ?? ''}）${msg}`);
    } catch (err: any) {
      toast.error(err?.message ?? '校验失败');
    }
  };

  return (
    <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
      {fields.map((field) => (
        <SettingsField
          key={field.key}
          field={field}
          value={values[field.key] ?? field.default}
          dataAdd="economy"
        />
      ))}

      <div className="rounded-xl border border-light-200 bg-light-primary/80 p-4 lg:p-6 transition-colors dark:border-dark-200 dark:bg-dark-primary/80">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-sm lg:text-sm text-black dark:text-white">
              校验 TuShare Token
            </h4>
            <p className="text-[11px] lg:text-xs text-black/50 dark:text-white/50">
              用于确认 token 是否有效，以及是否具备接口权限（不会泄露 token）。
            </p>
          </div>
          <button
            type="button"
            onClick={validateToken}
            className="inline-flex items-center gap-1 rounded-lg border border-light-200 dark:border-dark-200 bg-light-primary dark:bg-dark-primary px-3 py-2 !text-xs text-black/70 dark:text-white/70 hover:bg-light-200/60 dark:hover:bg-dark-200/60 transition"
          >
            立即校验
          </button>
        </div>
      </div>
    </div>
  );
};

export default Economy;
