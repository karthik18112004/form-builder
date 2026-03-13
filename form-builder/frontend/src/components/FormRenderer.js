import React, { useState } from 'react';

/**
 * Custom form renderer that:
 * 1. Renders fields from JSON Schema
 * 2. Handles x-show-when conditional visibility
 * 3. Uses data-testid attributes for testing
 */
export default function FormRenderer({ schema }) {
  const [formData, setFormData] = useState({});
  const [submitted, setSubmitted] = useState(false);

  if (!schema || !schema.properties) return null;

  const properties = schema.properties;
  const required = schema.required || [];

  const handleChange = (fieldName, value) => {
    setFormData(prev => ({ ...prev, [fieldName]: value }));
    setSubmitted(false);
  };

  const isVisible = (fieldName, fieldDef) => {
    const showWhen = fieldDef['x-show-when'];
    if (!showWhen) return true;
    const { field, equals } = showWhen;
    return formData[field] === equals;
  };

  const renderField = (fieldName, fieldDef) => {
    if (!isVisible(fieldName, fieldDef)) {
      return (
        <div
          key={fieldName}
          data-testid={`field-${fieldName}`}
          style={{ display: 'none' }}
        />
      );
    }

    const isRequired = required.includes(fieldName);
    const value = formData[fieldName] ?? '';

    return (
      <div
        key={fieldName}
        className="form-field"
        data-testid={`field-${fieldName}`}
      >
        {fieldDef.type !== 'boolean' && (
          <label className="field-label" htmlFor={fieldName}>
            {fieldDef.title || fieldName}
            {isRequired && <span className="field-required">*</span>}
          </label>
        )}

        {renderInput(fieldName, fieldDef, value, isRequired)}

        {fieldDef.description && (
          <p className="field-description">{fieldDef.description}</p>
        )}
      </div>
    );
  };

  const renderInput = (fieldName, fieldDef, value, isRequired) => {
    // Boolean / checkbox
    if (fieldDef.type === 'boolean') {
      return (
        <div className="field-checkbox-wrapper">
          <input
            type="checkbox"
            id={fieldName}
            name={fieldName}
            className="field-checkbox"
            checked={!!formData[fieldName]}
            onChange={e => handleChange(fieldName, e.target.checked)}
            data-testid={`input-${fieldName}`}
          />
          <label className="field-label" htmlFor={fieldName} style={{ margin: 0 }}>
            {fieldDef.title || fieldName}
          </label>
        </div>
      );
    }

    // Enum / select
    if (fieldDef.enum) {
      return (
        <select
          id={fieldName}
          name={fieldName}
          className="field-select"
          value={value}
          onChange={e => handleChange(fieldName, e.target.value)}
          required={isRequired}
          data-testid={`input-${fieldName}`}
        >
          <option value="">Select an option...</option>
          {fieldDef.enum.map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      );
    }

    // Textarea for long strings
    if (fieldDef.type === 'string' && (fieldDef.maxLength > 200 || fieldDef.format === 'textarea' || fieldName.toLowerCase().includes('message') || fieldName.toLowerCase().includes('description') || fieldName.toLowerCase().includes('comment'))) {
      return (
        <textarea
          id={fieldName}
          name={fieldName}
          className="field-textarea"
          value={value}
          onChange={e => handleChange(fieldName, e.target.value)}
          placeholder={fieldDef.description || ''}
          required={isRequired}
          data-testid={`input-${fieldName}`}
        />
      );
    }

    // Number
    if (fieldDef.type === 'number' || fieldDef.type === 'integer') {
      return (
        <input
          type="number"
          id={fieldName}
          name={fieldName}
          className="field-input"
          value={value}
          onChange={e => handleChange(fieldName, e.target.value === '' ? '' : Number(e.target.value))}
          min={fieldDef.minimum}
          max={fieldDef.maximum}
          required={isRequired}
          data-testid={`input-${fieldName}`}
        />
      );
    }

    // Specific string formats
    const typeMap = {
      email: 'email',
      date: 'date',
      'date-time': 'datetime-local',
      time: 'time',
      uri: 'url',
      password: 'password',
    };

    const inputType = fieldDef.format
      ? (typeMap[fieldDef.format] || 'text')
      : (fieldName.toLowerCase().includes('password') ? 'password' : 'text');

    return (
      <input
        type={inputType}
        id={fieldName}
        name={fieldName}
        className="field-input"
        value={value}
        onChange={e => handleChange(fieldName, e.target.value)}
        placeholder={fieldDef.description || ''}
        required={isRequired}
        minLength={fieldDef.minLength}
        maxLength={fieldDef.maxLength}
        pattern={fieldDef.pattern}
        data-testid={`input-${fieldName}`}
      />
    );
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setSubmitted(true);
  };

  return (
    <div className="form-container">
      {schema.title && <h2 className="form-title">{schema.title}</h2>}
      {schema.description && <p className="form-description">{schema.description}</p>}

      <form onSubmit={handleSubmit} noValidate>
        {Object.entries(properties).map(([fieldName, fieldDef]) =>
          renderField(fieldName, fieldDef)
        )}

        <button type="submit" className="form-submit-btn">
          Submit Form
        </button>
      </form>

      {submitted && (
        <div style={{ marginTop: 16, padding: '12px 16px', background: '#1a472a', borderRadius: 8, color: '#3fb950', fontSize: 14 }}>
          ✅ Form submitted! (Demo only — data not sent anywhere)
        </div>
      )}
    </div>
  );
}
