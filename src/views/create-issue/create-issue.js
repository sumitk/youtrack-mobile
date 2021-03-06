import {ScrollView, View, Text, TouchableOpacity, Image, AsyncStorage, Platform} from 'react-native';
import React from 'react';

import styles from './create-issue.styles';
import issueStyles from '../single-issue/single-issue.styles';
import Header from '../../components/header/header';
import {notifyError, resolveError} from '../../components/notification/notification';
import usage from '../../components/usage/usage';
import Router from '../../components/router/router';
import log from '../../components/log/log';
import {attach, tag, next} from '../../components/icon/icon';
import CustomFieldsPanel from '../../components/custom-fields-panel/custom-fields-panel';
import AttachmentsRow from '../../components/attachments-row/attachments-row';
import KeyboardSpacer from 'react-native-keyboard-spacer';
import IssueSummary from '../../components/issue-summary/issue-summary';
import attachFile from '../../components/attach-file/attach-file';
import IssuePermissions from '../../components/issue-permissions/issue-permissions';

export const PROJECT_ID_STORAGE_KEY = 'YT_DEFAULT_CREATE_PROJECT_ID_STORAGE';
export const DRAFT_ID_STORAGE_KEY = 'DRAFT_ID_STORAGE_KEY';
const CATEGORY_NAME = 'Create issue view';

const notSelectedProject = {
  id: null,
  shortName: 'Not selected'
};

export default class CreateIssue extends React.Component {
  constructor(props) {
    super(props);
    this.issuePermissions = new IssuePermissions(props.api.auth.permissions, props.api.auth.currentUser);

    this.state = {
      processing: false,
      attachingImage: null,

      issue: {
        summary: null,
        description: null,
        attachments: [],
        fields: [],
        project: notSelectedProject
      }
    };

    this.descriptionInput = null;
    usage.trackScreenView('Create issue');

    this.initializeWithDraftOrProject(props.draftId);
  }

  async initializeWithDraftOrProject(preDefinedDraftId) {
    const draftId = preDefinedDraftId || await AsyncStorage.getItem(DRAFT_ID_STORAGE_KEY);
    if (draftId) {
      await this.loadIssueFromDraft(draftId);
    }
    await this.loadStoredProject();
  }

  async loadStoredProject() {
    const projectId = await AsyncStorage.getItem(PROJECT_ID_STORAGE_KEY);
    if (projectId) {
      this.state.issue.project.id = projectId;
      return await this.updateIssueDraft();
    }
  }

  async loadIssueFromDraft(draftId) {
    try {
      this.setState({
        issue: await this.props.api.loadIssueDraft(draftId)
      });
    } catch (err) {
      AsyncStorage.removeItem(DRAFT_ID_STORAGE_KEY);
      this.state.issue.id = null;
      return await this.loadStoredProject();
    }
  }

  async updateIssueDraft(projectOnly = false) {
    const issueToSend = {...this.state.issue};
    if (!issueToSend.project || !issueToSend.project.id) {
      return;
    }

    //If we're changing project, fields shouldn't be passed to avoid "incompatible-issue-custom-field" error
    if (projectOnly) {
      delete issueToSend.fields;
    }

    try {
      const issue = await this.props.api.updateIssueDraft(issueToSend);
      this.setState({issue});
      if (!this.props.draftId) {
        return await AsyncStorage.setItem(DRAFT_ID_STORAGE_KEY, issue.id);
      }
    } catch (err) {
      const error = await resolveError(err);
      if (error && error.error_description && error.error_description.indexOf(`Can't find entity with id`) !== -1) {
        return this.setState({issue: {...this.state.issue, project: notSelectedProject}});
      }
      notifyError('Cannot update issue draft', error);
    }
  }

  async createIssue() {
    this.setState({processing: true});

    try {
      await this.updateIssueDraft();
      const created = await this.props.api.createIssue(this.state.issue);
      log.info('Issue created', created);

      usage.trackEvent(CATEGORY_NAME, 'Issue created', 'Success');
      this.props.onCreate(created);
      Router.pop();
      return await AsyncStorage.removeItem(DRAFT_ID_STORAGE_KEY);

    } catch (err) {
      usage.trackEvent(CATEGORY_NAME, 'Issue created', 'Error');
      return notifyError('Cannot create issue', err);
    } finally {
      this.setState({processing: false});
    }
  }

  async attachPhoto(takeFromLibrary = true) {
    try {
      const attachingImage = await attachFile(takeFromLibrary ? 'launchImageLibrary' : 'launchCamera');

      this.setState({
        issue: {
          ...this.state.issue,
          attachments: [attachingImage].concat(this.state.issue.attachments)
        },
        attachingImage
      });

      try {
        await this.props.api.attachFile(this.state.issue.id, attachingImage.url, attachingImage.name);
        usage.trackEvent(CATEGORY_NAME, 'Attach image', 'Success');

      } catch (err) {
        notifyError('Cannot attach file', err);
        this.setState({
          issue: {
            ...this.state.issue,
            attachments: this.state.issue.attachments.filter(attach => attach !== attachingImage)
          }
        });
      }
      this.setState({attachingImage: null});
    } catch (err) {
      notifyError('ImagePicker error', err);
    }
  }

  async onUpdateProject(project) {
    await new Promise(resolve => {
      this.setState({issue: {...this.state.issue, project}}, resolve);
    });

    usage.trackEvent(CATEGORY_NAME, 'Change project');
    await this.updateIssueDraft(project.id);
    return await AsyncStorage.setItem(PROJECT_ID_STORAGE_KEY, project.id);
  }

  async onSetFieldValue(field, value) {
    await new Promise(resolve => {
      this.setState({
        issue: {
          ...this.state.issue,
          fields: [...this.state.issue.fields].map(it => {
            return it === field ? {...it, value} : it;
          })
        }
      }, resolve);
    });

    usage.trackEvent(CATEGORY_NAME, 'Change field value');
    return await this.updateIssueDraft();
  }

  renderProjectSelector() {
    const project = this.state.issue.project;
    const projectSelected = project !== notSelectedProject;
    return (
      <TouchableOpacity
        disabled={this.state.processing}
        style={styles.selectProjectButton}
        onPress={() => this.fieldsPanel.onSelectProject()}
        >
        <Text style={styles.selectProjectText}>
          {projectSelected ? project.shortName : 'Select project'}
        </Text>
        <Image style={styles.selectProjectIcon} source={next} resizeMode="contain" />
      </TouchableOpacity>
    );
  }

  render() {
    const {issue, attachingImage, processing} = this.state;
    const canCreateIssue = issue.summary && issue.project.id && !processing && !attachingImage;

    const createButton = <Text style={canCreateIssue ? null : styles.disabledCreateButton}>Create</Text>;

    return (
      <View style={styles.container}>
        <Header leftButton={<Text>Cancel</Text>}
                onBack={() => {
                  this.updateIssueDraft();
                  Router.pop();
                }}
                rightButton={createButton}
                onRightButtonClick={() => canCreateIssue && this.createIssue()}>
          <Text style={issueStyles.headerText}>New Issue</Text>
        </Header>
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
          <View>
            {this.renderProjectSelector()}

            <View style={styles.separator} />

            <IssueSummary
              style={styles.issueSummary}
              showSeparator={true}
              summary={issue.summary}
              description={issue.description}
              editable={!processing}
              onSummaryChange={summary => this.setState({issue: {...issue, summary}})}
              onDescriptionChange={description => this.setState({issue: {...issue, description}})}
            />

              {issue.project.id && <View style={styles.attachesContainer}>

              <AttachmentsRow attachments={issue.attachments} attachingImage={attachingImage}/>

              <View style={styles.attachButtonsContainer}>
                <TouchableOpacity
                  disabled={attachingImage !== null}
                  style={styles.attachButton}
                  onPress={() => this.attachPhoto(true)}>
                  <Image style={styles.attachIcon} source={attach} resizeMode="contain"/>
                  <Text style={styles.attachButtonText}>Choose from library...</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  disabled={attachingImage !== null}
                  style={styles.attachButton}
                  onPress={() => this.attachPhoto(false)}>
                  <Text style={styles.attachButtonText}>Take a picture...</Text>
                </TouchableOpacity>
              </View>
            </View>}
            <View style={styles.separator}/>
            {false && <View style={styles.actionContainer}>
              <Image style={styles.actionIcon} source={tag}/>
              <View style={styles.actionContent}>
                <Text>Add tag</Text>
                <Image style={styles.arrowImage} source={next}></Image>
              </View>
            </View>}
          </View>
        </ScrollView>

        <CustomFieldsPanel
          ref={node => this.fieldsPanel = node}
          api={this.props.api}
          issue={issue}
          canEditProject={true}
          issuePermissions={this.issuePermissions}
          onUpdate={this.onSetFieldValue.bind(this)}
          onUpdateProject={this.onUpdateProject.bind(this)}
        />

        {Platform.OS == 'ios' && <KeyboardSpacer style={{backgroundColor: 'black'}}/>}
      </View>
    );
  }
}
