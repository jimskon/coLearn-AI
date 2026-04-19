// components/activity/ActivityQuestionBlock.jsx
import React from 'react';
import { Form, Table } from 'react-bootstrap';
import { makeResponseAttrs } from '../../utils/responseDom';

export default function ActivityQuestionBlock({ question, editable = false }) {
  // Must be stable and unique within the submit scope
  const qid = question.qid || question.id || question.key;
  return (
    <div className="mb-4">
      <p dangerouslySetInnerHTML={{ __html: question.text }} />
      {editable ? (
        <Form.Control
          as="textarea"
          rows={question.responseLines || 1}
          placeholder="Your response..."
          {...makeResponseAttrs({ key: qid, kind: "text", qid })}
          defaultValue={question.prefill || ""}
        />) : (
        <Form.Control
          as="textarea"
          disabled
          rows={question.responseLines || 1}
          value="(Student will answer here in Run mode)"
          {...makeResponseAttrs({ key: qid, kind: "text", qid })}
        />)}
      {question.samples.length > 0 && (
        <>
          <h6>Sample Responses</h6>
          <Table bordered size="sm">
            <tbody>
              {question.samples.map((r, idx) => <tr key={idx}><td>{r}</td></tr>)}
            </tbody>
          </Table>
        </>
      )}
      {question.feedback.length > 0 && (
        <>
          <h6>Feedback Prompts</h6>
          <Table bordered size="sm">
            <tbody>
              {question.feedback.map((r, idx) => <tr key={idx}><td>{r}</td></tr>)}
            </tbody>
          </Table>
        </>
      )}
      {question.followups.length > 0 && (
        <>
          <h6>Followup Prompts</h6>
          <Table bordered size="sm">
            <tbody>
              {question.followups.map((r, idx) => <tr key={idx}><td>{r}</td></tr>)}
            </tbody>
          </Table>
        </>
      )}
    </div>
  );
}