import { InputHTMLAttributes } from "react";
import styled from "styled-components";

const Wrapper = styled.div`
  display: flex;
  align-items: center;
  border-radius: 4px;
  overflow: hidden;

  & * {
    flex: 1;
    height: 100%;
    font-size: 1rem;
  }

  & input {
    border-radius: 0;
    border: none;
    width: 100px;
    outline: none;
    padding: 4px;
  }

  & span {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: #313552;
    color: white;
    padding: 4px 8px;
  }
`;

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
};

export const Input = ({ label, ...props }: InputProps) => {
  return (
    <Wrapper>
      {label && <span>{label}</span>}
      <input {...props} />
    </Wrapper>
  );
};
