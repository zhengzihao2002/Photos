package photos.controller;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;

import javafx.fxml.FXML;
import javafx.geometry.Pos;
import javafx.scene.image.Image;
import javafx.scene.image.ImageView;
import javafx.scene.layout.Pane;
import javafx.scene.layout.StackPane;
import javafx.stage.Stage;
import photos.utility.Album;
import photos.utility.Photo;
import photos.utility.SceneLoader;

/**
The slideshowController class is responsible for managing the slideshow functionality of the Photos application.
It displays a slideshow of photos in an album and allows the user to navigate between them.
@author Zihao Zheng
@author Yiming Huang
@version 1.0
@since 2023-04-13
*/
public class slideshowController{
	/**The reference to the main stage*/
	Stage mainStage;
	@FXML ImageView image;
	@FXML StackPane father;
	/**The current index of the slideshow*/
	int currIndex = 0;
	/**The arraylist of photo names in the slideshow*/
	ArrayList<String> photoNames = null;
	/**The directory of the running program*/
    String currentDir = System.getProperty("user.dir");
    /**The directory of the current user*/
	String storageDir = currentDir+"/src/photos/local/"+albumController.user.getUsername();
	
	/**
	 * Set the main stage of the slideshow.
	 * 
	 * @param stage The main stage of the application.
	 * @throws IOException If an input/output error occurs.
	 */
	public void setMainStage(Stage stage) throws IOException{		
		// Keep the copy of "The Stage"
		mainStage = stage;
		
		// load the photo in
		Album albumObj= albumController.albumObj;
		photoNames = new ArrayList<>();

		for(Photo photo : albumObj.getPhotos()) {
		    String path = photo.getName();
		    photoNames.add(path);
		}
		
		Image img = new Image(new File(storageDir+File.separator+photoNames.get(0)).toURI().toString());
		image.setImage(img);
		
		//cover
//		image.setPreserveRatio(false);
		
		// contain
		image.setPreserveRatio(true);
		
		image.setFitWidth(image.getLayoutBounds().getWidth());
		image.setFitHeight(image.getLayoutBounds().getHeight());
		
		image.setSmooth(true); // enable smoother image scaling
		father.setAlignment(Pos.CENTER);


	}
	
	/**
	 * Navigate to the album view.
	 * 
	 * @throws IOException If an input/output error occurs.
	 */
	public void back() throws IOException {
		SceneLoader.loadFXMLCenter("/photos/view/album.fxml", albumController.class,Pane.class,mainStage);
	}
	
	/**
	 * Navigate to the previous photo in the album.
	 */
	public void prevPhoto() {
		currIndex--;
		if(currIndex<0) {
			currIndex=photoNames.size()-1;
		}
		Image img = new Image(new File(storageDir+File.separator+photoNames.get(currIndex)).toURI().toString());
		image.setImage(img);
	}
	
	/**
	 * Navigate to the next photo in the album.
	 */
	public void nextPhoto() {
		currIndex++;
		if(currIndex>=photoNames.size()) {
			currIndex=0;
		}
		Image img = new Image(new File(storageDir+File.separator+photoNames.get(currIndex)).toURI().toString());
		image.setImage(img);
	}
}