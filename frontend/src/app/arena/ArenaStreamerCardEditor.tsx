'use client';

import React from 'react';
import {
  AlertTriangle,
  Check,
  Gauge,
  HeartPulse,
  Info,
  Minus,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Swords,
  X
} from 'lucide-react';
import {
  applyArenaCardKeywordVariant,
  arenaCardBudgetByCost,
  arenaCardClassDefinitions,
  arenaCardKeywordDefinitions,
  createArenaCardKeywordSelection,
  evaluateArenaCardEditor,
  getArenaCardKeywordDefinition,
  getArenaCardKeywordVariant,
  type ArenaCardEditorForm
} from '@/lib/arenaCardEditor';

type ArenaStreamerCardEditorProps = {
  form: ArenaCardEditorForm;
  savedForm: ArenaCardEditorForm;
  canEdit: boolean;
  active: boolean;
  saving: boolean;
  serverErrors?: string[];
  preview: React.ReactNode;
  onChange: (form: ArenaCardEditorForm) => void;
  onSave: () => void;
  onReset: () => void;
  onToggle: (enabled: boolean) => void;
};

type StatStepperProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  unitCost: number;
  icon: typeof Swords;
  disabled: boolean;
  onChange: (value: number) => void;
};

const StatStepper: React.FC<StatStepperProps> = ({
  label,
  value,
  min,
  max,
  unitCost,
  icon: Icon,
  disabled,
  onChange
}) => (
  <div className={`arena-v2-card-stat-editor ${value > max ? 'is-invalid' : ''}`}>
    <div className="arena-v2-card-field-heading">
      <span><Icon /> {label}</span>
      <small>1당 비용 {unitCost}</small>
    </div>
    <div className="arena-v2-card-stepper">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={disabled || value <= min} aria-label={`${label} 1 감소`}>
        <Minus />
      </button>
      <strong>{value}</strong>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={disabled || value >= max} aria-label={`${label} 1 증가`}>
        <Plus />
      </button>
    </div>
    <div className="arena-v2-card-stat-foot">
      <span>최대 {max}</span>
      <b>비용 {Math.max(0, value) * unitCost}</b>
    </div>
  </div>
);

export const ArenaStreamerCardEditor: React.FC<ArenaStreamerCardEditorProps> = ({
  form,
  savedForm,
  canEdit,
  active,
  saving,
  serverErrors = [],
  preview,
  onChange,
  onSave,
  onReset,
  onToggle
}) => {
  const assessment = evaluateArenaCardEditor(form);
  const selectedClass = arenaCardClassDefinitions[form.cardClass as keyof typeof arenaCardClassDefinitions] || arenaCardClassDefinitions.charge;
  const dirty = JSON.stringify(form) !== JSON.stringify(savedForm);
  const budgetState = assessment.remaining < 0 ? 'is-over' : assessment.remaining <= 3 ? 'is-near' : 'is-safe';
  const allErrors = Array.from(new Set([...assessment.errors, ...serverErrors.filter(Boolean)]));

  const patchForm = (patch: Partial<ArenaCardEditorForm>) => onChange({ ...form, ...patch });

  return (
    <section className="arena-v2-card-studio">
      <aside className="arena-v2-card-preview-panel">
        <header className="arena-v2-card-panel-heading">
          <div>
            <strong>카드 미리보기</strong>
            <span>수정 내용이 바로 반영됩니다.</span>
          </div>
          <span className={active ? 'is-active' : 'is-inactive'}>{active ? '사용 중' : '비활성'}</span>
        </header>
        <div className="arena-v2-card-preview-stage">{preview}</div>
        <div className="arena-v2-card-activation">
          <div>
            <strong>{active ? '대전에서 사용 중' : '현재 비활성화됨'}</strong>
            <span>{active ? '이 카드가 내 카드 풀에 표시됩니다.' : '카드는 보존되지만 대전에서는 제외됩니다.'}</span>
          </div>
          <button type="button" onClick={() => onToggle(!active)} disabled={saving || !canEdit} className={active ? 'is-on' : ''} aria-pressed={active}>
            <span />
            <b>{active ? '사용' : '중지'}</b>
          </button>
        </div>
      </aside>

      <main className="arena-v2-card-editor-panel">
        <section className="arena-v2-card-editor-section">
          <header className="arena-v2-card-section-heading">
            <div>
              <strong>기본 정보</strong>
              <span>카드 이름과 전투 스타일을 정합니다.</span>
            </div>
          </header>
          <label className="arena-v2-card-field">
            <span>카드 이름 <small>{form.displayName.length}/40</small></span>
            <input
              value={form.displayName}
              maxLength={40}
              onChange={(event) => patchForm({ displayName: event.target.value })}
              placeholder="카드에 표시할 이름"
              disabled={!canEdit}
            />
          </label>
          <div className="arena-v2-card-class-row">
            <label className="arena-v2-card-field">
              <span>클래스</span>
              <select value={form.cardClass} onChange={(event) => patchForm({ cardClass: event.target.value })} disabled={!canEdit}>
                {Object.entries(arenaCardClassDefinitions).map(([value, definition]) => (
                  <option key={value} value={value}>{definition.label}</option>
                ))}
              </select>
            </label>
            <div className="arena-v2-card-class-explainer" role="status">
              <Swords />
              <div>
                <strong>{selectedClass.label} · {selectedClass.playstyle}</strong>
                <span>{selectedClass.description}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="arena-v2-card-editor-section">
          <header className="arena-v2-card-section-heading">
            <div>
              <strong>코스트와 능력치</strong>
              <span>코스트가 높을수록 사용할 수 있는 예산과 능력치 상한이 커집니다.</span>
            </div>
            <span className="arena-v2-card-budget-cap">예산 {assessment.budgetLimit}</span>
          </header>
          <div className="arena-v2-card-cost-picker" role="group" aria-label="카드 코스트 선택">
            {Object.keys(arenaCardBudgetByCost).map((costValue) => {
              const value = Number(costValue);
              return (
                <button
                  key={value}
                  type="button"
                  className={form.cost === value ? 'is-selected' : ''}
                  aria-pressed={form.cost === value}
                  onClick={() => patchForm({ cost: value })}
                  disabled={!canEdit}
                >
                  <b>{value}</b>
                  <span>예산 {arenaCardBudgetByCost[value]}</span>
                </button>
              );
            })}
          </div>
          <div className="arena-v2-card-cost-help">
            <Info />
            <span>{form.cost}코스트 기준 공격력 최대 {assessment.statLimits.attackMax}, 체력 최대 {assessment.statLimits.healthMax}까지 설정할 수 있습니다.</span>
          </div>
          <div className="arena-v2-card-stat-grid">
            <StatStepper
              label="공격력"
              value={form.attack}
              min={0}
              max={assessment.statLimits.attackMax}
              unitCost={3}
              icon={Swords}
              disabled={!canEdit}
              onChange={(attack) => patchForm({ attack })}
            />
            <StatStepper
              label="체력"
              value={form.health}
              min={1}
              max={assessment.statLimits.healthMax}
              unitCost={1}
              icon={HeartPulse}
              disabled={!canEdit}
              onChange={(health) => patchForm({ health })}
            />
          </div>
        </section>

        <section className="arena-v2-card-editor-section">
          <header className="arena-v2-card-section-heading">
            <div>
              <strong>효과 키워드</strong>
              <span>최대 3개까지 선택할 수 있습니다. 영문 키를 외울 필요가 없습니다.</span>
            </div>
            <span>{form.keywords.length}/3</span>
          </header>
          <div className="arena-v2-card-keyword-editor">
            {form.keywords.map((selection, index) => {
              const definition = getArenaCardKeywordDefinition(selection.type);
              const variant = getArenaCardKeywordVariant(selection);
              return (
                <div key={`${selection.type}-${index}`} className="arena-v2-card-keyword-row">
                  <span className="arena-v2-card-keyword-index">{index + 1}</span>
                  <label className="arena-v2-card-keyword-select">
                    <span>키워드</span>
                    <select
                      value={selection.type}
                      onChange={(event) => {
                        const keywords = [...form.keywords];
                        keywords[index] = createArenaCardKeywordSelection(event.target.value);
                        patchForm({ keywords });
                      }}
                      disabled={!canEdit}
                    >
                      {arenaCardKeywordDefinitions.map((option) => (
                        <option
                          key={option.type}
                          value={option.type}
                          disabled={form.keywords.some((keyword, keywordIndex) => keywordIndex !== index && keyword.type === option.type)}
                        >
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {definition && definition.variants.length > 1 ? (
                    <label className="arena-v2-card-keyword-variant">
                      <span>효과 단계</span>
                      <select
                        value={Math.max(0, definition.variants.findIndex((item) => item === variant))}
                        onChange={(event) => {
                          const keywords = [...form.keywords];
                          keywords[index] = applyArenaCardKeywordVariant(selection, Number(event.target.value));
                          patchForm({ keywords });
                        }}
                        disabled={!canEdit}
                      >
                        {definition.variants.map((option, variantIndex) => (
                          <option key={`${option.label}-${variantIndex}`} value={variantIndex}>{option.label} · 비용 {option.cost}</option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <div className="arena-v2-card-keyword-description">
                    <span>{definition?.description || '선택한 키워드의 설명을 불러올 수 없습니다.'}</span>
                    <b>+{variant?.cost || 0}</b>
                  </div>
                  <button
                    type="button"
                    className="arena-v2-card-keyword-remove"
                    onClick={() => patchForm({ keywords: form.keywords.filter((_, keywordIndex) => keywordIndex !== index) })}
                    disabled={!canEdit}
                    aria-label={`${definition?.label || '키워드'} 제거`}
                  >
                    <X />
                  </button>
                </div>
              );
            })}
            {form.keywords.length < 3 ? (
              <button
                type="button"
                className="arena-v2-card-keyword-add"
                onClick={() => {
                  const nextDefinition = arenaCardKeywordDefinitions.find((definition) => !form.keywords.some((keyword) => keyword.type === definition.type));
                  if (nextDefinition) patchForm({ keywords: [...form.keywords, createArenaCardKeywordSelection(nextDefinition.type)] });
                }}
                disabled={!canEdit}
              >
                <Plus /> 키워드 추가
              </button>
            ) : null}
          </div>
        </section>

        {allErrors.length ? (
          <div className="arena-v2-card-validation" role="alert">
            <AlertTriangle />
            <div>
              <strong>저장 전에 확인해주세요.</strong>
              {allErrors.map((message) => <span key={message}>{message}</span>)}
            </div>
          </div>
        ) : (
          <div className="arena-v2-card-validation is-valid" role="status">
            <Check />
            <div><strong>저장 가능한 구성입니다.</strong><span>예산과 조합 제한을 모두 만족합니다.</span></div>
          </div>
        )}

        <footer className="arena-v2-card-editor-actions">
          <button type="button" onClick={onReset} disabled={!dirty || saving} className="arena-v2-card-reset-button">
            <RotateCcw /> 저장된 상태로 초기화
          </button>
          <button type="button" onClick={onSave} disabled={!canEdit || !dirty || !assessment.valid || saving} className="arena-v2-card-save-button">
            <Save /> {saving ? '저장 중…' : '변경사항 저장'}
          </button>
        </footer>
      </main>

      <aside className={`arena-v2-card-budget-panel ${budgetState}`}>
        <header>
          <div>
            <Gauge />
            <strong>비용 계산</strong>
          </div>
          <Info aria-label="총비용은 공격력, 체력, 키워드, 강한 조합의 추가 비용을 합산합니다." />
        </header>
        <div className="arena-v2-card-budget-total">
          <span>현재 비용</span>
          <strong>{assessment.totalCost} <small>/ 예산 {assessment.budgetLimit}</small></strong>
        </div>
        <div className="arena-v2-card-budget-track" aria-label={`예산 ${assessment.budgetLimit} 중 ${assessment.totalCost} 사용`}>
          <span style={{ width: `${assessment.usagePercent}%` }} />
        </div>
        <div className="arena-v2-card-budget-remaining">
          <span>{assessment.remaining >= 0 ? '남은 비용' : '초과 비용'}</span>
          <strong>{Math.abs(assessment.remaining)}</strong>
        </div>
        <div className="arena-v2-card-budget-list">
          <div><span><Swords /> 공격력 {form.attack} × 3</span><b>{assessment.attackCost}</b></div>
          <div><span><HeartPulse /> 체력 {form.health} × 1</span><b>{assessment.healthCost}</b></div>
          {assessment.keywordLines.map((line) => <div key={line.code}><span><Sparkles /> {line.label}</span><b>{line.cost}</b></div>)}
          {assessment.comboLines.map((line) => <div key={line.code} className="is-surcharge"><span><Gauge /> {line.label}</span><b>+{line.cost}</b></div>)}
          <div className="is-total"><span>합계</span><b>{assessment.totalCost}</b></div>
        </div>
        <p>
          {assessment.remaining < 0
            ? '예산을 초과했습니다. 능력치나 키워드를 낮추면 저장할 수 있습니다.'
            : assessment.remaining <= 3
              ? '예산을 거의 모두 사용했습니다. 조합 추가 비용을 한 번 더 확인하세요.'
              : '남은 비용 안에서 능력치나 키워드를 더 선택할 수 있습니다.'}
        </p>
      </aside>
    </section>
  );
};
