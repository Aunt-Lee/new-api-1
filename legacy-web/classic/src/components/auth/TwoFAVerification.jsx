/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { API, showError, showSuccess } from '../../helpers';
import {
  Button,
  Card,
  Divider,
  Form,
  Input,
  Typography,
} from '@douyinfe/semi-ui';
import React, { useState } from 'react';

const { Title, Text, Paragraph } = Typography;

const TwoFAVerification = ({ onSuccess, onBack, isModal = false }) => {
  const [loading, setLoading] = useState(false);
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');

  const handleSubmit = async () => {
    if (!verificationCode) {
      showError('Please enter the verification code');
      return;
    }
    // Validate code format
    if (useBackupCode && verificationCode.length !== 8) {
      showError('The backup code must be 8 characters');
      return;
    } else if (!useBackupCode && !/^\d{6}$/.test(verificationCode)) {
      showError('The verification code must be 6 digits');
      return;
    }

    setLoading(true);
    try {
      const res = await API.post('/api/user/login/2fa', {
        code: verificationCode,
      });

      if (res.data.success) {
        showSuccess('Signed in successfully');
        // 保存用户信息到本地存储
        localStorage.setItem('user', JSON.stringify(res.data.data));
        if (onSuccess) {
          onSuccess(res.data.data);
        }
      } else {
        showError(res.data.message);
      }
    } catch (error) {
      showError('Verification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSubmit();
    }
  };

  if (isModal) {
    return (
      <div className='space-y-4'>
        <Paragraph className='text-gray-600 dark:text-gray-300'>
          Enter the code shown in your authenticator app to sign in
        </Paragraph>

        <Form onSubmit={handleSubmit}>
          <Form.Input
            field='code'
            label={useBackupCode ? 'Backup code' : 'Verification code'}
            placeholder={useBackupCode ? 'Enter your 8-character backup code' : 'Enter your 6-digit verification code'}
            value={verificationCode}
            onChange={setVerificationCode}
            onKeyPress={handleKeyPress}
            size='large'
            style={{ marginBottom: 16 }}
            autoFocus
          />

          <Button
            htmlType='submit'
            type='primary'
            loading={loading}
            block
            size='large'
            style={{ marginBottom: 16 }}
          >
            Verify and sign in
          </Button>
        </Form>

        <Divider />

        <div style={{ textAlign: 'center' }}>
          <Button
            theme='borderless'
            type='tertiary'
            onClick={() => {
              setUseBackupCode(!useBackupCode);
              setVerificationCode('');
            }}
            style={{ marginRight: 16, color: '#1890ff', padding: 0 }}
          >
            {useBackupCode ? 'Use authenticator code' : 'Use backup code'}
          </Button>

          {onBack && (
            <Button
              theme='borderless'
              type='tertiary'
              onClick={onBack}
              style={{ color: '#1890ff', padding: 0 }}
            >
              Back to sign in
            </Button>
          )}
        </div>

        <div className='bg-gray-50 dark:bg-gray-800 rounded-lg p-3'>
          <Text size='small' type='secondary'>
            <strong>Note:</strong>
            <br />
            • Verification codes refresh every 30 seconds
            <br />
            • Use a backup code if you cannot access your authenticator
            <br />• Each backup code can only be used once
          </Text>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '60vh',
      }}
    >
      <Card style={{ width: 400, padding: 24 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Title heading={3}>Two-factor authentication</Title>
          <Paragraph type='secondary'>
            Enter the code shown in your authenticator app to sign in
          </Paragraph>
        </div>

        <Form onSubmit={handleSubmit}>
          <Form.Input
            field='code'
            label={useBackupCode ? 'Backup code' : 'Verification code'}
            placeholder={useBackupCode ? 'Enter your 8-character backup code' : 'Enter your 6-digit verification code'}
            value={verificationCode}
            onChange={setVerificationCode}
            onKeyPress={handleKeyPress}
            size='large'
            style={{ marginBottom: 16 }}
            autoFocus
          />

          <Button
            htmlType='submit'
            type='primary'
            loading={loading}
            block
            size='large'
            style={{ marginBottom: 16 }}
          >
            Verify and sign in
          </Button>
        </Form>

        <Divider />

        <div style={{ textAlign: 'center' }}>
          <Button
            theme='borderless'
            type='tertiary'
            onClick={() => {
              setUseBackupCode(!useBackupCode);
              setVerificationCode('');
            }}
            style={{ marginRight: 16, color: '#1890ff', padding: 0 }}
          >
            {useBackupCode ? 'Use authenticator code' : 'Use backup code'}
          </Button>

          {onBack && (
            <Button
              theme='borderless'
              type='tertiary'
              onClick={onBack}
              style={{ color: '#1890ff', padding: 0 }}
            >
              Back to sign in
            </Button>
          )}
        </div>

        <div
          style={{
            marginTop: 24,
            padding: 16,
            background: '#f6f8fa',
            borderRadius: 6,
          }}
        >
          <Text size='small' type='secondary'>
            <strong>Note:</strong>
            <br />
            • Verification codes refresh every 30 seconds
            <br />
            • Use a backup code if you cannot access your authenticator
            <br />• Each backup code can only be used once
          </Text>
        </div>
      </Card>
    </div>
  );
};

export default TwoFAVerification;
